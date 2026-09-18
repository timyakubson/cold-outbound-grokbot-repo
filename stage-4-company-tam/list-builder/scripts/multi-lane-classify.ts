#!/usr/bin/env tsx
/**
 * multi-lane-classify.ts — union N lanes' candidate pools and label every unique
 * company in ONE nano pass (WS1, 2026-07-14).
 *
 *     npx tsx multi-lane-classify.ts --lanes=a.json,b.json,c.json \
 *        [--out-dir=/abs/dir] [--concurrency=200] [--scrape] [--limit=N] [--resume]
 *
 * Why: when several lanes for the same client draw from OVERLAPPING industry/
 * keyword pulls, scoring each lane separately re-judges the same company N times.
 * This unions every lane's MERGE candidate pool by domain and runs a single
 * multi-label classification (labels = lane names) whose prompt is assembled from
 * each lane's judge ICP one-liner. Each company is assigned the single best lane
 * (or "none"). Per-lane candidate CSVs are written for consumption as
 * `extra_candidates` in that lane's lane.json.
 *
 * This is ADDITIVE — it does not touch run-lane's default per-lane flow. Use it
 * to pre-partition a shared universe before running each lane, or to reconcile
 * overlap after the fact.
 *
 * Candidate pool per lane = <runDir>/candidates.csv (from MERGE) if present, else
 * <runDir>/pull-all.csv. Output per-lane CSV columns: domain, name, text_excerpt,
 * source (= "multi-lane-classify"). Feed a lane its file via extra_candidates.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { loadEnv, parseArgs, readCsv, writeCsv, requireEnv, httpJson, mapConcurrent, fetchHomepageText, normDomain, csvEscape } from "../../list-expander/scripts/lib";

loadEnv();
process.on("unhandledRejection", (e) => console.error("unhandled:", String(e).slice(0, 120)));
const args = parseArgs();

const lanePaths = String(args.lanes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (lanePaths.length < 1) { console.error("Need --lanes=a.json,b.json,..."); process.exit(1); }
const model = String(args.model ?? process.env.OPENAI_ICP_MODEL ?? "gpt-5-nano");
const apiKey = process.env.OPENAI_API_KEY_NANO ?? requireEnv("OPENAI_API_KEY");
const CONC = Number(args.concurrency ?? 200);
const ROW_DEADLINE_MS = Number(args["row-timeout"] ?? 120_000);

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve(onTimeout()); } }, ms);
    p.then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
     .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(onTimeout()); } });
  });
}

type Lane = { label: string; cfg: any; runDir: string; icp: string };

function icpOneLiner(promptFile: string): string {
  if (!existsSync(promptFile)) return "(prompt file missing)";
  const txt = readFileSync(promptFile, "utf8");
  const m = txt.match(/^\s*ICP:\s*(.+)$/mi);
  return (m?.[1] ?? txt.split("\n").find((l) => l.trim())?.slice(0, 240) ?? "").trim();
}

const lanes: Lane[] = lanePaths.map((p) => {
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  const runDir = String(cfg.run_dir ?? join(homedir(), "output", "list-builder", "lanes", `${cfg.client_slug}-${cfg.name}`));
  return { label: cfg.name, cfg, runDir, icp: icpOneLiner(cfg.prompt) };
});
const labels = lanes.map((l) => l.label);
if (new Set(labels).size !== labels.length) { console.error("lane names must be unique (they are the classification labels)"); process.exit(1); }

const outDir = String(args["out-dir"] ?? join(homedir(), "output", "list-builder", "multi-lane-classify"));
mkdirSync(outDir, { recursive: true });

const SEGMENTS_PROMPT =
  "Assign the company to the SINGLE best-fitting segment below, or \"none\" if it fits no segment.\n\n" +
  lanes.map((l) => `SEGMENT "${l.label}": ${l.icp}`).join("\n") + "\n";

async function classifyInner(row: Record<string, string>): Promise<Record<string, unknown>> {
  let evidence = row.text_excerpt || row.description || "";
  if (!evidence && args.scrape && row.domain) evidence = await fetchHomepageText(normDomain(row.domain), 3000);
  if (!evidence) return { ...row, segment: "none", confidence: "", reason: "no evidence", scored: false };
  const body = {
    model,
    messages: [
      { role: "system", content: `You are a strict B2B segment classifier. Respond ONLY with JSON: {"segment": "<one of: ${labels.join("|")}|none>", "confidence": 0.0-1.0, "reason": "<one sentence>"}` },
      { role: "user", content: `${SEGMENTS_PROMPT}\n---\nCOMPANY: ${row.name ?? ""} (${row.domain ?? ""})\nINDUSTRY TAG: ${row.industry ?? ""}\nEVIDENCE:\n${evidence.slice(0, 3200)}\n\nAssign the single best segment or "none". JSON only.` },
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
  return { ...row, segment: "none", scored: false };
}
const classify = (row: Record<string, string>) => withTimeout(classifyInner(row), ROW_DEADLINE_MS, () => ({ ...row, segment: "none", confidence: "", reason: "timeout", scored: false }));

async function main() {
  // union candidate pools by domain
  const pool = new Map<string, Record<string, string>>();
  for (const l of lanes) {
    const cand = join(l.runDir, "candidates.csv");
    const pull = join(l.runDir, "pull-all.csv");
    const src = existsSync(cand) ? cand : existsSync(pull) ? pull : "";
    if (!src) { console.error(`⚠️ lane "${l.label}": no candidates.csv/pull-all.csv in ${l.runDir} — contributes 0 to the union`); continue; }
    let added = 0;
    for (const r of readCsv(src)) {
      const d = normDomain(r.domain ?? r.website ?? "");
      if (!d || !d.includes(".")) continue;
      if (!pool.has(d)) { pool.set(d, { ...r, domain: d, text_excerpt: r.text_excerpt || r.description || "" }); added++; }
    }
    console.log(`lane "${l.label}": pooled ${added} from ${src.split("/").pop()}`);
  }
  let rows = [...pool.values()];
  if (args.limit) rows = rows.slice(0, Number(args.limit));
  console.log(`union: ${rows.length} unique companies across ${lanes.length} lanes → classifying into [${labels.join(", ")}]`);

  const streamPath = join(outDir, "classified.stream.csv");
  const STREAM_COLS = ["domain", "name", "industry", "employee_count", "state", "text_excerpt", "segment", "confidence", "reason"];
  const done = new Set<string>();
  if (existsSync(streamPath) && args.resume) { for (const r of readCsv(streamPath)) done.add(r.domain); console.log(`resume: ${done.size} already classified`); }
  else writeFileSync(streamPath, STREAM_COLS.join(",") + "\n");
  const todo = rows.filter((r) => !done.has(r.domain));

  let n = 0; const tally: Record<string, number> = {};
  const results = await mapConcurrent(todo, CONC, async (row) => {
    const r = await classify(row);
    appendFileSync(streamPath, STREAM_COLS.map((c) => csvEscape((r as any)[c])).join(",") + "\n");
    tally[String((r as any).segment)] = (tally[String((r as any).segment)] ?? 0) + 1;
    if (++n % 500 === 0) console.log(`  ${n}/${todo.length} — ${JSON.stringify(tally)}`);
    return r;
  });

  // write per-lane extra_candidates CSVs (from the full stream, incl. resumed rows)
  const all = readCsv(streamPath);
  const perLane: Record<string, Record<string, string>[]> = Object.fromEntries(labels.map((l) => [l, []]));
  for (const r of all) if (perLane[r.segment]) perLane[r.segment].push({ domain: r.domain, name: r.name, text_excerpt: r.text_excerpt, source: "multi-lane-classify" });
  const summary: string[] = [];
  for (const l of lanes) {
    const outCsv = join(outDir, `${l.cfg.client_slug}-${l.label}-candidates.csv`);
    writeCsv(outCsv, perLane[l.label]);
    summary.push(`  ${l.label}: ${perLane[l.label].length} → ${outCsv}`);
  }
  console.log(`\nfinal tally: ${JSON.stringify(tally)}`);
  console.log(`per-lane candidate files (add each to its lane's extra_candidates):`);
  console.log(summary.join("\n"));
  void results;
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
