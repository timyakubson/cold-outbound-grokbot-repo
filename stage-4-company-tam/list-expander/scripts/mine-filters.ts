#!/usr/bin/env tsx
/**
 * Phase 3 — Filter mining. From a CSV of CONFIRMED-fit companies, mine
 * candidate database filters and score each for volume + sampled precision.
 *
 * Two modes, usually run in sequence:
 *
 * 1) --propose : fingerprint confirmed companies (Prospeo record + live
 *    homepage text), print industry/keyword/n-gram frequency tables, and emit
 *    candidates.json (Claude then reviews/edits candidates.json — add keyword
 *    synonyms, remove generic terms — before scoring.)
 *    Pass --no-scrape to mine from Prospeo descriptions only (faster, thinner).
 *
 * 2) --scorecard : for each candidate filter, get the Prospeo total_count
 *    (page-1 count trick, cheap), pull a 25-company sample, and write
 *    sample CSVs for qualification. After running score-batch.ts on the
 *    samples, rerun with --scorecard to fold in precision.
 *
 * Usage:
 *   npx tsx mine-filters.ts --csv=confirmed.csv --run=medical-groups --propose
 *   npx tsx mine-filters.ts --run=medical-groups --scorecard [--country="United States #US"]
 *   npx tsx mine-filters.ts --run=medical-groups --scorecard --precision-from=samples-scored/
 *
 * candidates.json format:
 *   { "industries": ["Medical Practices", ...],
 *     "keywords": ["medical group", "multispecialty", ...],
 *     "base_filters": { "company_location_search": {"include": ["United States #US"]} } }
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  loadEnv, parseArgs, readCsv, writeCsv, normDomain, outDir,
  prospeoSearch, prospeoCompanyRow, fetchHomepageText, mapConcurrent, maybeHelp,
} from "./lib";

maybeHelp(`
mine-filters.ts — Phase 3: mine + score candidate search filters.

  npx tsx mine-filters.ts --csv=confirmed.csv --run=<slug> --propose [--no-scrape] [--country="United States #US"]
  npx tsx mine-filters.ts --run=<slug> --scorecard
  npx tsx mine-filters.ts --run=<slug> --scorecard --precision-from=<samples-scored-dir>

Requires PROSPEO_API_KEY. Writes <run>/candidates.json and <run>/filter-scorecard.csv.
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);
const candidatesPath = join(dir, "candidates.json");

const STOPWORDS = new Set("the and for with our your their of in to a an we you they is are be by on at from as or that this it its all more most other services company companies group inc llc care health medical center".split(" "));

async function propose() {
  const csvPath = String(args.csv ?? "");
  if (!csvPath) { console.error("Need --csv=confirmed.csv"); process.exit(1); }
  const rows = readCsv(csvPath);
  const domains = [...new Set(rows.map((r) => normDomain(r.domain)).filter(Boolean))];
  console.log(`Fingerprinting ${domains.length} confirmed companies for filter mining...`);

  const industries = new Map<string, number>();
  const kwTags = new Map<string, number>();
  const grams = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => k && m.set(k, (m.get(k) ?? 0) + 1);

  // Live homepage text is the evidence source for n-gram mining: it says what a
  // company calls itself today, which is exactly what a keyword filter must match.
  const homepages = args["no-scrape"]
    ? domains.map(() => "")
    : await mapConcurrent(domains, 5, (d) => fetchHomepageText(d, 3000).catch(() => ""));
  const texts: string[] = [];
  for (let i = 0; i < domains.length; i++) {
    const r = await prospeoSearch("search-company", { company: { websites: { include: [domains[i]] } } });
    const p = r.results.length ? prospeoCompanyRow(r.results[0]) : null;
    if (p) { bump(industries, String(p.industry)); for (const k of String(p.keywords ?? "").split(";")) bump(kwTags, k.trim()); }
    const text = [p?.description, homepages[i], rows.find((x) => normDomain(x.domain) === domains[i])?.text_excerpt]
      .filter(Boolean).join(" ").toLowerCase();
    texts.push(text);
  }

  // n-gram mining (2-3 grams) across confirmed-company texts, counted once per company
  for (const text of texts) {
    const words = text.replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const seen = new Set<string>();
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n);
        if (STOPWORDS.has(g[0]) || STOPWORDS.has(g[g.length - 1])) continue;
        const s = g.join(" ");
        if (!seen.has(s)) { seen.add(s); bump(grams, s); }
      }
    }
  }

  const top = (m: Map<string, number>, minFrac: number) =>
    [...m.entries()].filter(([, n]) => n >= Math.max(2, domains.length * minFrac)).sort((a, b) => b[1] - a[1]);

  console.log("\n== Prospeo industries (candidates):");
  for (const [v, n] of top(industries, 0.1)) console.log(`  ${n}/${domains.length}  ${v}`);
  console.log("\n== Prospeo keyword tags carried by the set:");
  for (const [v, n] of top(kwTags, 0.1).slice(0, 20)) console.log(`  ${n}/${domains.length}  ${v}`);
  console.log("\n== Top n-grams (keyword candidates — REVIEW, drop generic ones):");
  for (const [v, n] of top(grams, 0.15).slice(0, 40)) console.log(`  ${n}/${domains.length}  ${v}`);

  const candidates = {
    industries: top(industries, 0.1).map(([v]) => v),
    keywords: top(grams, 0.2).slice(0, 25).map(([v]) => v),
    base_filters: args.country ? { company_location_search: { include: [String(args.country)] } } : {},
    _note: "EDIT ME before --scorecard: prune generic keywords, add Claude-proposed synonyms.",
  };
  writeFileSync(candidatesPath, JSON.stringify(candidates, null, 2));
  console.log(`\nWrote ${candidatesPath} — review/edit keywords, then run with --scorecard`);
}

async function scorecard() {
  if (!existsSync(candidatesPath)) { console.error(`Missing ${candidatesPath} — run --propose first`); process.exit(1); }
  const cand = JSON.parse(readFileSync(candidatesPath, "utf8"));
  const base = cand.base_filters ?? {};
  type Row = { type: string; value: string; prospeo_filter: string; prospeo_count: number | null; sample_file?: string; precision?: number | string; est_qualified_yield?: number | string };
  const rows: Row[] = [];

  // Load precision results if provided (scored sample CSVs from score-batch.ts)
  const precision = new Map<string, number>();
  if (args["precision-from"]) {
    const pdir = String(args["precision-from"]);
    for (const f of readdirSync(pdir).filter((f) => f.endsWith(".csv"))) {
      const scored = readCsv(join(pdir, f)).filter((r) => r.scored !== "false" && r.qualified !== "");
      if (!scored.length) continue;
      const q = scored.filter((r) => r.qualified === "true").length;
      precision.set(f.replace(/-scored\.csv$|\.csv$/, ""), q / scored.length);
    }
    console.log(`Loaded precision for ${precision.size} filters from ${pdir}`);
  }

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);

  async function evalFilter(type: string, value: string, prospeoFilters: Record<string, unknown>) {
    const r = await prospeoSearch("search-company", { ...base, ...prospeoFilters });
    const key = `${type}-${slug(value)}`;
    // write sample for precision scoring
    let sampleFile: string | undefined;
    if (r.results.length) {
      sampleFile = join(dir, "samples", `${key}.csv`);
      writeCsv(sampleFile, r.results.map((it) => {
        const c = prospeoCompanyRow(it);
        return { domain: c.domain, name: c.name, industry: c.industry, text_excerpt: c.description };
      }));
    }
    const p = precision.get(key);
    rows.push({
      type, value, prospeo_filter: JSON.stringify(prospeoFilters),
      prospeo_count: r.total_count, sample_file: sampleFile,
      precision: p != null ? Math.round(p * 100) / 100 : "",
      est_qualified_yield: p != null && r.total_count != null ? Math.round(r.total_count * p) : "",
    });
    console.log(`  [${type}] "${value}": prospeo=${r.total_count ?? "ERR"} precision=${p != null ? (p * 100).toFixed(0) + "%" : "?"}`);
  }

  console.log(`Scoring ${(cand.industries ?? []).length} industries + ${(cand.keywords ?? []).length} keywords...`);
  for (const ind of cand.industries ?? []) {
    await evalFilter("industry", ind, { company_industry: { include: [ind] } });
  }
  for (const kw of cand.keywords ?? []) {
    await evalFilter("keyword", kw, { company_keywords: { include: [kw] } });
  }

  rows.sort((a, b) => (Number(b.est_qualified_yield) || 0) - (Number(a.est_qualified_yield) || 0) || (b.prospeo_count ?? 0) - (a.prospeo_count ?? 0));
  writeCsv(join(dir, "filter-scorecard.csv"), rows as any);
  writeFileSync(join(dir, "filter-scorecard.json"), JSON.stringify(rows, null, 2));
  console.log(`\nScorecard → ${join(dir, "filter-scorecard.csv")}`);
  if (!precision.size) console.log("Next: score the sample CSVs in samples/ with score-batch.ts, put outputs in one dir, rerun --scorecard --precision-from=<dir>");
}

(args.propose ? propose() : args.scorecard ? scorecard() : (console.error("Pass --propose or --scorecard"), process.exit(1)) as never)
  .catch((e: any) => { console.error(e); process.exit(1); });
