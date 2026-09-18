#!/usr/bin/env tsx
/**
 * Cheap-API qualification scorer (GPT-5 Nano-style). Scores companies against
 * a tuned ICP prompt at scale. Also closes the gap in icp-prompt-builder
 * (which references a score-batch script that never existed).
 *
 * Input CSV needs: domain, name, and at least one of: text_excerpt / description /
 * homepage_text. Missing text → optionally scraped live with --scrape.
 *
 * Usage:
 *   npx tsx score-batch.ts --csv=candidates.csv --prompt-file=icp-prompt.txt \
 *     --out=scored.csv [--model=gpt-5-nano] [--concurrency=8] [--scrape] [--limit=100]
 *
 * Prompt contract: the prompt file describes the ICP; this script appends the
 * company evidence and asks for strict JSON {qualified, confidence, reason}.
 */
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "fs";
import {
  loadEnv, parseArgs, readCsv, writeCsv, requireEnv, httpJson, mapConcurrent, fetchHomepageText, normDomain, csvEscape, maybeHelp,
} from "./lib";

maybeHelp(`
score-batch.ts — AI qualification at scale. Scores companies against a tuned ICP prompt.

  npx tsx score-batch.ts --csv=candidates.csv --prompt-file=icp-prompt.txt \\
    [--out=scored.csv] [--model=gpt-5-nano] [--concurrency=8] [--scrape] [--limit=N] [--resume]

Input CSV needs a \`domain\` column plus one of text_excerpt / description /
homepage_text (or pass --scrape to fetch the homepage live).
Requires OPENAI_API_KEY (or OPENAI_API_KEY_NANO). Tune the prompt first with
/icp-prompt-builder. Results stream to <out>.stream.csv as they complete.
`);

loadEnv();
process.on("unhandledRejection", (e) => { console.error("unhandled:", String(e).slice(0, 120)); });
process.on("uncaughtException", (e) => { console.error("uncaught:", String(e).slice(0, 120)); });

const args = parseArgs();
const promptFile = String(args["prompt-file"] ?? "");
const csvPath = String(args.csv ?? "");
if (!promptFile || !csvPath) { console.error("Need --csv= and --prompt-file="); process.exit(1); }
const model = String(args.model ?? process.env.OPENAI_ICP_MODEL ?? "gpt-5-nano");
const out = String(args.out ?? csvPath.replace(/\.csv$/, "") + "-scored.csv");
const icpPrompt = readFileSync(promptFile, "utf8");
const apiKey = process.env.OPENAI_API_KEY_NANO ?? requireEnv("OPENAI_API_KEY");

// Hard per-row deadline (incl. scrape). A single hung fetch/API socket otherwise
// stalls the whole batch at 99.99% done — the watchdog then kills the stage even
// though only one row is stuck. 120s covers a slow scrape + 3 API attempts.
const ROW_DEADLINE_MS = Number(args["row-timeout"] ?? 120_000);
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(onTimeout()); } }, ms);
    p.then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
     .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(onTimeout()); } });
  });
}

async function scoreOneInner(row: Record<string, string>): Promise<Record<string, unknown>> {
  let evidence = row.homepage_text || row.text_excerpt || row.description || "";
  if (!evidence && args.scrape && row.domain) evidence = await fetchHomepageText(normDomain(row.domain), 3000);
  if (!evidence) return { ...row, qualified: "", confidence: "", reason: "no evidence text", scored: false };

  const body = {
    model,
    messages: [
      { role: "system", content: "You are a strict B2B list-qualification engine. Respond with ONLY a JSON object: {\"qualified\": true|false, \"confidence\": 0.0-1.0, \"reason\": \"<one sentence>\"}" },
      { role: "user", content: `${icpPrompt}\n\n---\nCOMPANY: ${row.name ?? ""} (${row.domain ?? ""})\nEVIDENCE:\n${evidence.slice(0, 3500)}\n\nDoes this company fit the ICP? JSON only.` },
    ],
    response_format: { type: "json_object" },
    ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await httpJson("https://api.openai.com/v1/chat/completions", {
        headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs: 60_000,
      });
      if (r.error) throw new Error(r.error.message ?? "api error");
      const j = JSON.parse(r.choices[0].message.content);
      return { ...row, qualified: !!j.qualified, confidence: Number(j.confidence ?? 0), reason: String(j.reason ?? "").slice(0, 200), scored: true };
    } catch (e: any) {
      if (attempt === 2) return { ...row, qualified: "", confidence: "", reason: `error: ${e.message}`.slice(0, 150), scored: false };
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  return row;
}

async function scoreOne(row: Record<string, string>): Promise<Record<string, unknown>> {
  return withTimeout(scoreOneInner(row), ROW_DEADLINE_MS, () => ({ ...row, qualified: "", confidence: "", reason: "timeout", scored: false }));
}

async function main() {
  let rows = readCsv(csvPath);
  if (args.limit) rows = rows.slice(0, Number(args.limit));
  console.log(`Scoring ${rows.length} companies with ${model} (concurrency ${args.concurrency ?? 8})`);
  let done = 0, qualified = 0;
  // Stream results to <out>.stream.csv as they complete (resumable + live-viewable)
  const streamPath = out + ".stream.csv";
  const STREAM_COLS = ["domain", "name", "industry", "state", "source_filters", "qualified", "confidence", "reason"];
  const alreadyScored = new Set<string>();
  if (existsSync(streamPath) && args.resume) {
    for (const r of readCsv(streamPath)) alreadyScored.add(r.domain);
    console.log(`Resuming: ${alreadyScored.size} already in stream file`);
  } else {
    writeFileSync(streamPath, STREAM_COLS.join(",") + "\n");
  }
  const scored = await mapConcurrent(rows, Number(args.concurrency ?? 8), async (row) => {
    if (alreadyScored.has(row.domain)) return { ...row, qualified: "", reason: "skipped (resume)", scored: false };
    const r = await scoreOne(row);
    done++;
    if (r.qualified === true) qualified++;
    appendFileSync(streamPath, STREAM_COLS.map((c) => csvEscape((r as any)[c])).join(",") + "\n");
    if (done % 50 === 0) console.log(`  ${done}/${rows.length} scored, ${qualified} qualified so far`);
    return r;
  });
  // ONE automatic retry pass over rows that ended scored=false (error / timeout /
  // no-evidence after scrape). Fresh attempts often clear transient socket/DNS
  // hangs and rate-limit blips. Retried results are appended to the stream, then
  // the stream is deduped by domain (last-wins) so the pre-retry failure rows
  // don't double-count downstream.
  const failedRows = scored.filter((r) => !r.scored && !alreadyScored.has(String((r as any).domain)));
  if (failedRows.length) {
    console.log(`retry pass: re-scoring ${failedRows.length} failures`);
    let recovered = 0;
    await mapConcurrent(failedRows, Number(args.concurrency ?? 8), async (row) => {
      const r = await scoreOne(row as Record<string, string>);
      if ((r as any).scored) recovered++;
      const idx = scored.findIndex((x) => (x as any).domain === (row as any).domain);
      if (idx >= 0) scored[idx] = r;
      appendFileSync(streamPath, STREAM_COLS.map((c) => csvEscape((r as any)[c])).join(",") + "\n");
      return r;
    });
    // collapse duplicate domain rows (retry appended a second row) — keep last
    const byDomain = new Map<string, Record<string, string>>();
    for (const r of readCsv(streamPath)) byDomain.set(r.domain, r);
    writeFileSync(streamPath, STREAM_COLS.join(",") + "\n" + [...byDomain.values()].map((r) => STREAM_COLS.map((c) => csvEscape(r[c])).join(",")).join("\n") + "\n");
    console.log(`retry pass: recovered ${recovered}/${failedRows.length}`);
  }
  writeCsv(out, scored);
  const failed = scored.filter((r) => !r.scored).length;
  console.log(`\nDone: ${scored.filter((r) => r.qualified === true).length}/${rows.length} qualified, ${failed} scoring failures → ${out}`);
  if (failed > rows.length * 0.2) console.error("WARNING: >20% scoring failures — check API key/model before trusting this run.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
