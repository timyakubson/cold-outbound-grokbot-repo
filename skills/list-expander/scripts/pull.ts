#!/usr/bin/env tsx
/**
 * Phase 4 — Wide pull. Pulls all companies matching the WINNING filters
 * (edited into winners.json after scorecard review) from Prospeo
 * /search-company, deduped, with optional exclusion list.
 *
 * winners.json format (in the run dir):
 * {
 *   "filter_sets": [
 *     { "label": "kw-medical-group", "filters": { "company_keywords": {"include": ["medical group"]}, "company_industry": {"include": ["Medical Practices"]} } },
 *     { "label": "lookalike-atlantic", "filters": { "company_lookalike": {"domain": "atlantichealth.org"} } }
 *   ],
 *   "base_filters": { "company_location_search": {"include": ["United States #US"]}, "company_headcount_custom": {"min": 10, "max": 10000} }
 * }
 *
 * Each filter set is paginated to completion (25/page, hard cap 25k/set —
 * if a set's total_count > 24k the script warns: split it by state/headcount).
 *
 * Usage:
 *   npx tsx pull.ts --run=medical-groups [--exclude=existing.csv] [--max-pages=999] [--test]
 *   (--test pulls only 2 pages per set — use first per the no-dry-runs-on-large-data rule)
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadEnv, parseArgs, readCsv, writeCsv, normDomain, outDir,
  prospeoSearch, prospeoCompanyRow, US_STATES, maybeHelp,
} from "./lib";

maybeHelp(`
pull.ts — Phase 4: wide pull of every company matching the winning filters.

  npx tsx pull.ts --run=<slug> --test                     (2 pages/set — always run this first)
  npx tsx pull.ts --run=<slug> [--exclude=existing.csv] [--max-pages=999]

Reads <run>/winners.json (format documented at the top of this file), writes
<run>/pull-all.csv. Auto-shards any filter set over 24k results by state, then by
headcount band, so the tail is never truncated. Requires PROSPEO_API_KEY.
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);
const winnersPath = join(dir, "winners.json");
if (!existsSync(winnersPath)) { console.error(`Missing ${winnersPath} — create it from the scorecard winners`); process.exit(1); }
const winners = JSON.parse(readFileSync(winnersPath, "utf8"));
const maxPages = args.test ? 2 : Number(args["max-pages"] ?? 999);

const exclude = new Set<string>();
if (args.exclude) for (const r of readCsv(String(args.exclude))) exclude.add(normDomain(r.domain ?? r.website ?? r.company_domain ?? ""));

const SHARD_CAP = 24000; // Prospeo hard-truncates a single filter's tail near 25k

function ingest(results: any[], label: string, all: Map<string, Record<string, unknown>>): void {
  for (const item of results) {
    const row = prospeoCompanyRow(item);
    const d = String(row.domain);
    if (!d || exclude.has(d)) continue;
    const prev = all.get(d);
    if (prev) { if (!String(prev.source_filters).split("+").includes(label)) prev.source_filters = `${prev.source_filters}+${label}`; }
    else all.set(d, { ...row, source_filters: label });
  }
}

/** Compute shard variants of a filter that exceeds SHARD_CAP, or null if it can't
 *  be split further. Location-first (country-wide → 51 states → split state list),
 *  then headcount-band bisection. */
function shardOf(filters: Record<string, any>): Record<string, any>[] | null {
  const locInc: string[] = filters.company_location_search?.include ?? [];
  const isCountryWide = locInc.length === 1 && /#US$|United States$/i.test(locInc[0]) && !/,/.test(locInc[0]);
  if (isCountryWide) {
    return US_STATES.map((s) => ({ ...filters, company_location_search: { include: [`${s}, United States`] } }));
  }
  if (locInc.length > 1) {
    const mid = Math.ceil(locInc.length / 2);
    return [
      { ...filters, company_location_search: { include: locInc.slice(0, mid) } },
      { ...filters, company_location_search: { include: locInc.slice(mid) } },
    ];
  }
  // single state (or single specific location) → bisect the headcount band
  const band = filters.company_headcount_custom;
  if (band && Number(band.min) < Number(band.max)) {
    const lo = Number(band.min), hi = Number(band.max), mid = lo + Math.floor((hi - lo) / 2);
    return [
      { ...filters, company_headcount_custom: { min: lo, max: mid } },
      { ...filters, company_headcount_custom: { min: mid + 1, max: hi } },
    ];
  }
  return null;
}

async function pullFilter(filters: Record<string, any>, label: string, all: Map<string, Record<string, unknown>>, depth = 0): Promise<{ pulled: number; shards: number }> {
  const first = await prospeoSearch("search-company", filters, 1);
  if (first.error) { console.error(`  [${label}] ERROR: ${first.error_code} ${first.filter_error ?? ""}`); return { pulled: 0, shards: 0 }; }
  const total = first.total_count ?? 0;
  // auto-shard when a single filter would truncate its tail near 25k
  if (total > SHARD_CAP && !args.test && depth < 8) {
    const shards = shardOf(filters);
    if (shards) {
      console.log(`[${label}] total_count=${total} > ${SHARD_CAP} — sharding into ${shards.length} sub-pulls`);
      let pulled = 0, subs = 0;
      for (const sh of shards) { const r = await pullFilter(sh, label, all, depth + 1); pulled += r.pulled; subs += r.shards || 1; }
      console.log(`  sharded ${label} into ${subs} sub-pulls, recovered ${pulled} rows (page-1 total was ${total})`);
      return { pulled, shards: subs };
    }
    console.log(`[${label}] total_count=${total} > ${SHARD_CAP} but not shardable further — pulling with tail truncation`);
  } else if (depth === 0) {
    console.log(`[${label}] total_count=${total}`);
  }
  ingest(first.results, label, all);
  let pulled = first.results.length;
  for (let p = 2; p <= maxPages; p++) {
    if (pulled >= total) break;
    const r = await prospeoSearch("search-company", filters, p);
    if (r.error) { console.error(`  [${label}] p${p} ERROR: ${r.error_code} ${r.filter_error ?? ""}`); break; }
    if (!r.results.length) break;
    ingest(r.results, label, all);
    pulled += r.results.length;
  }
  return { pulled, shards: 0 };
}

async function main() {
  const all = new Map<string, Record<string, unknown>>();
  for (const set of winners.filter_sets ?? []) {
    const filters = { ...(winners.base_filters ?? {}), ...set.filters };
    const { pulled } = await pullFilter(filters, set.label, all);
    console.log(`  [${set.label}] pulled ${pulled} rows, ${all.size} unique domains so far`);
  }
  const out = join(dir, args.test ? "pull-test.csv" : "pull-all.csv");
  const rows = [...all.values()].map((r) => ({ ...r, text_excerpt: r.description }));
  writeCsv(out, rows);
  console.log(`\n${rows.length} unique companies (after ${exclude.size}-domain exclusion) → ${out}`);
  console.log("Next: score with score-batch.ts (add --scrape to fill missing descriptions), then report.ts");
}

main().catch((e) => { console.error(e); process.exit(1); });
