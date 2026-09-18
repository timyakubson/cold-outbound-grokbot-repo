#!/usr/bin/env tsx
/**
 * Multi-class segment classifier — one nano pass assigns each company to ONE
 * segment (or none), instead of N binary judges. Prompt file must describe the
 * segments and output labels.
 *
 * Usage: npx tsx classify-batch.ts --csv=companies.csv --prompt-file=segments.txt \
 *          --labels=hedge,pe,vc,re --out=classified.csv [--concurrency=50] [--scrape] [--limit=N]
 * Output adds: segment (label or "none"), confidence, reason. Streams to <out>.stream.csv.
 */
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "fs";
import { loadEnv, parseArgs, readCsv, writeCsv, requireEnv, httpJson, mapConcurrent, fetchHomepageText, normDomain, csvEscape } from "../../list-expander/scripts/lib";

loadEnv();
process.on("unhandledRejection", (e) => { console.error("unhandled:", String(e).slice(0, 120)); });
process.on("uncaughtException", (e) => { console.error("uncaught:", String(e).slice(0, 120)); });

const args = parseArgs();
const USAGE = "Usage: npx tsx classify-batch.ts --csv=companies.csv --prompt-file=segments.txt --labels=a,b,c --out=classified.csv [--concurrency=50] [--scrape] [--limit=N]";
for (const req of ["csv", "prompt-file", "labels", "out"]) {
  if (!args[req]) { console.error(`${USAGE}\n  missing --${req}`); process.exit(1); }
}
const prompt = readFileSync(String(args["prompt-file"]), "utf8");
const labels = String(args.labels).split(",").map((s) => s.trim());
const model = String(args.model ?? process.env.OPENAI_ICP_MODEL ?? "gpt-5-nano");
const apiKey = process.env.OPENAI_API_KEY_NANO ?? requireEnv("OPENAI_API_KEY");
const out = String(args.out);
const streamPath = out + ".stream.csv";
const STREAM_COLS = ["domain", "name", "industry", "employee_count", "state", "segment", "confidence", "reason"];

async function classify(row: Record<string, string>): Promise<Record<string, unknown>> {
  let evidence = row.text_excerpt || row.description || "";
  if (!evidence && args.scrape && row.domain) evidence = await fetchHomepageText(normDomain(row.domain), 3000);
  if (!evidence) return { ...row, segment: "none", confidence: "", reason: "no evidence", scored: false };
  const body = {
    model,
    messages: [
      { role: "system", content: `You are a strict B2B segment classifier. Respond ONLY with JSON: {"segment": "<one of: ${labels.join("|")}|none>", "confidence": 0.0-1.0, "reason": "<one sentence>"}` },
      { role: "user", content: `${prompt}\n\n---\nCOMPANY: ${row.name ?? ""} (${row.domain ?? ""})\nINDUSTRY TAG: ${row.industry ?? ""}\nEVIDENCE:\n${evidence.slice(0, 3200)}\n\nAssign the single best segment or "none". JSON only.` },
    ],
    response_format: { type: "json_object" },
    ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : {}),
  };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await httpJson("https://api.openai.com/v1/chat/completions", { headers: { Authorization: `Bearer ${apiKey}` }, body, timeoutMs: 60_000 });
      if (r.error) throw new Error(r.error.message);
      const j = JSON.parse(r.choices[0].message.content);
      const seg = labels.includes(j.segment) ? j.segment : "none";
      return { ...row, segment: seg, confidence: Number(j.confidence ?? 0), reason: String(j.reason ?? "").slice(0, 180), scored: true };
    } catch (e) { if (a === 2) return { ...row, segment: "none", confidence: "", reason: "error", scored: false }; await new Promise((res) => setTimeout(res, 1500 * (a + 1))); }
  }
  return row;
}

async function main() {
  let rows = readCsv(String(args.csv));
  if (args.limit) rows = rows.slice(0, Number(args.limit));
  const done = new Set<string>();
  if (existsSync(streamPath) && args.resume) for (const r of readCsv(streamPath)) done.add(r.domain);
  else writeFileSync(streamPath, STREAM_COLS.join(",") + "\n");
  const todo = rows.filter((r) => !done.has(r.domain));
  console.log(`classifying ${todo.length}/${rows.length} companies into [${labels.join(", ")}]`);
  let n = 0; const tally: Record<string, number> = {};
  const results = await mapConcurrent(todo, Number(args.concurrency ?? 50), async (row) => {
    const r = await classify(row);
    appendFileSync(streamPath, STREAM_COLS.map((c) => csvEscape((r as any)[c])).join(",") + "\n");
    tally[String(r.segment)] = (tally[String(r.segment)] ?? 0) + 1;
    if (++n % 500 === 0) console.log(`  ${n}/${todo.length} — ${JSON.stringify(tally)}`);
    return r;
  });
  writeCsv(out, results as any);
  console.log(`done: ${JSON.stringify(tally)} → ${out}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
