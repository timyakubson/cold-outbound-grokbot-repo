#!/usr/bin/env tsx
/**
 * REJECT_AUDIT stage — automated false-negative detector (WS4).
 *
 * The production pattern (2026-07-03): the strict lane judge rejects real fits
 * for thin evidence; a lenient re-judge rescued 76 Medicare + 127 RE companies.
 * This makes that rescue a standing pipeline stage:
 *
 * 1. Take rejects from <run-dir>/pull-batch1-scored.csv.stream.csv whose text
 *    contains a signal term (derived from seed names/domains + lane keywords).
 * 2. Deterministic sample (seeded hash order) up to --sample (default 150).
 * 3. Re-judge with a LENIENT wrapper around the same prompt.
 * 4. disagreement rate > --threshold (default 0.15) ⇒ rescue ALL flagged-class
 *    rejects (not just the sample): re-score with the lenient wrapper and
 *    append newly-qualified rows to the scored stream (verify picks them up).
 *
 * Artifacts: reject-audit.csv (sample + verdicts + rescued flag), exit 0 always
 * unless hard error — the audit INFORMS, run-lane records counts.
 */
import { readFileSync, appendFileSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { loadEnv, parseArgs, readCsv, writeCsv, requireEnv, httpJson, mapConcurrent, csvEscape } from "../../list-expander/scripts/lib";

loadEnv();
process.on("unhandledRejection", (e) => console.error("unhandled:", String(e).slice(0, 120)));
const args = parseArgs();
if (!args["run-dir"] || !args["prompt-file"]) {
  console.error("Usage: npx tsx reject-audit.ts --run-dir=<lane run dir> --prompt-file=<judge prompt>\n" +
    "  [--seeds=a.com,b.com] [--sample=150] [--threshold=0.15] [--stream-file=...] [--cand-csv=...] [--out=...]");
  process.exit(1);
}
const runDir = String(args["run-dir"]);
const promptFile = String(args["prompt-file"]);
const SAMPLE = Number(args.sample ?? 150);
const THRESHOLD = Number(args.threshold ?? 0.15);
const model = String(process.env.OPENAI_ICP_MODEL ?? "gpt-5-nano");
const apiKey = process.env.OPENAI_API_KEY_NANO ?? requireEnv("OPENAI_API_KEY");
// --stream-file / --cand-csv let a snowball round audit ITS scored stream + its
// candidate CSV (default = the first run-lane batch, backward-compatible).
const streamPath = args["stream-file"] ? String(args["stream-file"]) : join(runDir, "pull-batch1-scored.csv.stream.csv");
const candCsv = args["cand-csv"] ? String(args["cand-csv"]) : join(runDir, "candidates.csv");
const outPath = args["out"] ? String(args["out"]) : join(runDir, "reject-audit.csv");

const LENIENT_WRAP = `IMPORTANT RECALIBRATION: you are auditing possible FALSE NEGATIVES. Apply the ICP below,
but resolve ties toward QUALIFIED: if the company's identity language is consistent with the
ICP and there is no positive evidence of a disqualifying business type, answer qualified=true
with modest confidence. Missing details (size, locations, revenue, AUM) are never grounds to reject.\n\n`;

function signalTerms(): string[] {
  const seeds = String(args.seeds ?? "").split(",").filter(Boolean);
  const prompt = readFileSync(promptFile, "utf8").toLowerCase();
  // signal terms = quoted phrases + capitalized-ish keywords from QUALIFIES section, plus seed name tokens
  const terms = new Set<string>();
  for (const m of prompt.matchAll(/"([^"]{4,40})"/g)) terms.add(m[1].toLowerCase());
  const qualSection = prompt.split("does not qualify")[0];
  for (const m of qualSection.matchAll(/\b([a-z]{4,}(?: [a-z]{3,}){1,2})\b/g)) if (m[1].split(" ").length >= 2) terms.add(m[1]);
  for (const s of seeds) { const base = s.split(".")[0]; if (base.length > 5) terms.add(base.toLowerCase()); }
  return [...terms].slice(0, 400);
}

async function judge(row: Record<string, string>, lenient: boolean): Promise<{ q: boolean; reason: string }> {
  const prompt = (lenient ? LENIENT_WRAP : "") + readFileSync(promptFile, "utf8");
  const body = {
    model,
    messages: [
      { role: "system", content: 'Respond ONLY with JSON: {"qualified": true|false, "confidence": 0.0-1.0, "reason": "<one sentence>"}' },
      { role: "user", content: `${prompt}\n\n---\nCOMPANY: ${row.name} (${row.domain})\nEVIDENCE:\n${(row.text_excerpt || "").slice(0, 3200)}\n\nJSON only.` },
    ],
    response_format: { type: "json_object" },
    ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
  };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await httpJson("https://api.openai.com/v1/chat/completions", { headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs: 60_000 });
      if (r.error) throw new Error(r.error.message);
      const j = JSON.parse(r.choices[0].message.content);
      return { q: !!j.qualified, reason: String(j.reason ?? "").slice(0, 160) };
    } catch (e) { if (a === 2) return { q: false, reason: "audit error" }; await new Promise((res) => setTimeout(res, 1500)); }
  }
  return { q: false, reason: "audit error" };
}

async function main() {
  if (!existsSync(streamPath)) { console.log("no scored stream — nothing to audit"); writeCsv(outPath, []); return; }
  const scored = readCsv(streamPath);
  // candidates text lives in candidates.csv (stream cols don't carry text)
  const candText = new Map(existsSync(candCsv) ? readCsv(candCsv).map((r) => [r.domain, r.text_excerpt || r.description || ""]) : []);
  const terms = signalTerms();
  const flagged = scored.filter((r) => {
    if (r.qualified === "true") return false;
    const text = (candText.get(r.domain) || r.reason || "").toLowerCase();
    return terms.some((t) => text.includes(t));
  }).map((r): Record<string, string> => ({ ...r, text_excerpt: candText.get(r.domain) || "" }));
  if (!flagged.length) { console.log("0 flagged rejects — audit clean"); writeCsv(outPath, []); return; }

  // deterministic sample: sort by sha of domain, take first N
  const sample = [...flagged].sort((a, b) => sha(a.domain).localeCompare(sha(b.domain))).slice(0, SAMPLE);
  console.log(`auditing ${sample.length} of ${flagged.length} flagged rejects (threshold ${THRESHOLD})`);
  let disagree = 0;
  const results = await mapConcurrent(sample, 40, async (row) => {
    const v = await judge(row, true);
    if (v.q) disagree++;
    return { domain: row.domain, name: row.name, original_reason: row.reason, lenient_qualified: v.q, lenient_reason: v.reason, rescued: "false" };
  });
  const rate = disagree / sample.length;
  console.log(`disagreement rate: ${(rate * 100).toFixed(1)}% (${disagree}/${sample.length})`);

  if (rate > THRESHOLD) {
    console.log(`> threshold — rescuing ALL ${flagged.length} flagged rejects with lenient judge`);
    const rescued = await mapConcurrent(flagged, 60, async (row) => {
      const v = await judge(row, true);
      return { row, v };
    });
    let n = 0;
    const COLS = ["domain", "name", "industry", "state", "source_filters", "qualified", "confidence", "reason"];
    for (const { row, v } of rescued) {
      if (!v.q) continue;
      n++;
      appendFileSync(streamPath, COLS.map((c) => csvEscape(c === "qualified" ? "true" : c === "reason" ? `rescued: ${v.reason}` : c === "source_filters" ? `${row.source_filters}+rescued` : (row as any)[c])).join(",") + "\n");
      const hit = results.find((x) => x.domain === row.domain);
      if (hit) hit.rescued = "true";
      else results.push({ domain: row.domain, name: row.name, original_reason: row.reason, lenient_qualified: true, lenient_reason: v.reason, rescued: "true" });
    }
    console.log(`${n} rescued into scored stream (verify will re-check them on live sites)`);
  }
  writeCsv(outPath, results);
}

function sha(s: string): string { return createHash("sha256").update(s).digest("hex"); }
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
