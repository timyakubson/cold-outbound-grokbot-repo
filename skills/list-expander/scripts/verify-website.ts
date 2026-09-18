#!/usr/bin/env tsx
/**
 * Second-pass website verifier. For each QUALIFIED domain in the scorer stream
 * files, fetches the homepage LIVE and classifies:
 *   dead            — no connection / HTTP error on both https and http
 *   suspended-parked — connects but shows a suspended/parked/for-sale/coming-soon page
 *   live            — real site → re-run the ICP prompt on the LIVE text:
 *                     final_verdict = verified | live-not-match
 * Appends to {run}/verified.stream.csv as it goes (resumable via state in the file itself).
 * Keeps polling the scorer streams until the scorers exit and everything is caught up.
 *
 * Usage: npx tsx verify-website.ts --run=medical-groups --prompt-file=... [--concurrency=40] [--once]
 */
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { loadEnv, parseArgs, readCsv, csvEscape, requireEnv, httpJson, outDir, BROWSER_UA, mapConcurrent, sleep, maybeHelp } from "./lib";

maybeHelp(`
verify-website.ts — second pass: fetch every QUALIFIED company's homepage LIVE and re-judge it.

  npx tsx verify-website.ts --run=<slug> --prompt-file=<icp-prompt.txt> [--concurrency=40] [--once]

Watches <run>/pull-batch*-scored.csv.stream.csv, appends to <run>/verified.stream.csv.
Verdicts: verified | live-not-match | suspended-parked | dead.
Requires OPENAI_API_KEY (or OPENAI_API_KEY_NANO). Always run this — stale DB
descriptions happily qualify companies whose websites are dead.
`);

loadEnv();
process.on("unhandledRejection", (e) => { console.error("unhandled:", String(e).slice(0, 120)); });
process.on("uncaughtException", (e) => { console.error("uncaught:", String(e).slice(0, 120)); });

const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);
const promptFile = String(args["prompt-file"] ?? "");
if (!promptFile) { console.error("Need --prompt-file="); process.exit(1); }
const icpPrompt = readFileSync(promptFile, "utf8");
const apiKey = process.env.OPENAI_API_KEY_NANO ?? requireEnv("OPENAI_API_KEY");
const model = String(args.model ?? process.env.OPENAI_ICP_MODEL ?? "gpt-5-nano");
const CONC = Number(args.concurrency ?? 40);

import { readdirSync } from "fs";
const STREAMS = () => readdirSync(dir).filter((f) => /^pull-batch\d+-scored\.csv\.stream\.csv$/.test(f)).map((f) => join(dir, f));
const OUT = join(dir, "verified.stream.csv");
const COLS = ["domain", "name", "industry", "state", "source_filters", "confidence", "reason", "website_status", "final_verdict", "live_reason"];

const PARKED_PATTERNS = [
  "account suspended", "this account has been suspended", "domain is parked", "parked domain",
  "buy this domain", "domain for sale", "this domain may be for sale", "purchase this domain",
  "coming soon", "under construction", "website expired", "sedoparking", "hugedomains",
  "godaddy.com/domainsearch", "future home of something", "site not published", "default web site page",
  "this site is temporarily unavailable", "index of /",
];

async function fetchLive(domain: string): Promise<{ status: string; text: string }> {
  for (const proto of ["https", "http"]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`${proto}://${domain}/`, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" }, signal: ctrl.signal, redirect: "follow",
      });
      clearTimeout(t);
      if (res.status >= 400) continue;
      const html = await res.text();
      const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
      const lower = (html.slice(0, 20000) + " " + body.slice(0, 3000)).toLowerCase();
      if (PARKED_PATTERNS.some((p) => lower.includes(p)) && body.length < 2500) return { status: "suspended-parked", text: body.slice(0, 500) };
      if (body.length < 150) return { status: "suspended-parked", text: body };
      return { status: "live", text: body.slice(0, 3500) };
    } catch { /* try http */ }
  }
  return { status: "dead", text: "" };
}

async function nanoVerdict(name: string, domain: string, liveText: string): Promise<{ ok: boolean; reason: string }> {
  const body = {
    model,
    messages: [
      { role: "system", content: 'You are a strict B2B list-qualification engine. Respond ONLY with JSON: {"qualified": true|false, "reason": "<one sentence>"}' },
      { role: "user", content: `${icpPrompt}\n\n---\nCOMPANY: ${name} (${domain})\nLIVE HOMEPAGE TEXT:\n${liveText}\n\nDoes this company fit the ICP? JSON only.` },
    ],
    response_format: { type: "json_object" },
    ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
  };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await httpJson("https://api.openai.com/v1/chat/completions", { headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs: 60_000 });
      if (r.error) throw new Error(r.error.message);
      const j = JSON.parse(r.choices[0].message.content);
      return { ok: !!j.qualified, reason: String(j.reason ?? "").slice(0, 180) };
    } catch (e) { if (a === 2) return { ok: false, reason: "verdict error" }; await sleep(1500 * (a + 1)); }
  }
  return { ok: false, reason: "verdict error" };
}

function scorersAlive(): boolean {
  try { execSync("pgrep -f 'score-batch'", { stdio: "pipe" }); return true; } catch { return false; }
}

async function main() {
  const done = new Set<string>();
  if (existsSync(OUT)) for (const r of readCsv(OUT)) done.add(r.domain);
  else writeFileSync(OUT, COLS.join(",") + "\n");
  console.log(`verify-website: ${done.size} already verified; watching streams...`);

  let idle = 0;
  while (true) {
    const todo: Record<string, string>[] = [];
    for (const s of STREAMS()) {
      if (!existsSync(s)) continue;
      for (const r of readCsv(s)) if (r.qualified === "true" && r.domain && !done.has(r.domain)) { done.add(r.domain); todo.push(r); }
    }
    if (todo.length) {
      idle = 0;
      console.log(`verifying ${todo.length} new qualified domains...`);
      let verified = 0, deadN = 0, parked = 0, notMed = 0;
      await mapConcurrent(todo, CONC, async (r) => {
        let live = await fetchLive(r.domain);
        if (live.status === "dead") { await sleep(5000); live = await fetchLive(r.domain); } // transient DNS kills real companies — retry once
        let finalVerdict = "", liveReason = "";
        if (live.status === "live") {
          const v = await nanoVerdict(r.name, r.domain, live.text);
          finalVerdict = v.ok ? "verified" : "live-not-match";
          liveReason = v.reason;
          v.ok ? verified++ : notMed++;
        } else {
          finalVerdict = live.status;
          live.status === "dead" ? deadN++ : parked++;
        }
        appendFileSync(OUT, COLS.map((c) => csvEscape(c === "website_status" ? live.status : c === "final_verdict" ? finalVerdict : c === "live_reason" ? liveReason : (r as any)[c])).join(",") + "\n");
      });
      console.log(`  batch done: ${verified} verified, ${notMed} live-not-match, ${parked} parked, ${deadN} dead`);
    } else {
      idle++;
      if (idle >= 2 && !scorersAlive()) { console.log("scorers finished and caught up — exiting"); break; }
      if (args.once) break;
      await sleep(30_000);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
