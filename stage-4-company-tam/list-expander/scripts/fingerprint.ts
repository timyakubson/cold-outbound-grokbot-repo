#!/usr/bin/env tsx
/**
 * Phase 1/3 — Seed fingerprinting.
 * For each input domain, record how it shows up in Prospeo (industry, keywords,
 * description, headcount) plus its live homepage text. Output: fingerprint.json
 * + fingerprint.csv + a terminal summary table of the industries/keywords the
 * set actually carries — that table is what Phase 3 mines filters from.
 *
 * Seeds missing from Prospeo are printed explicitly: that gap IS the
 * under-count story to show the client.
 *
 * Usage:
 *   npx tsx fingerprint.ts --domains="atlantichealth.org,summithealth.com" --run=medical-groups
 *   npx tsx fingerprint.ts --csv=seeds.csv --run=medical-groups   (csv needs a `domain` column)
 */
import { writeFileSync } from "fs";
import { join } from "path";
import {
  loadEnv, parseArgs, readCsv, writeCsv, normDomain, outDir,
  prospeoSearch, prospeoCompanyRow, fetchHomepageText, mapConcurrent, maybeHelp,
} from "./lib";

maybeHelp(`
fingerprint.ts — Phase 1: how the databases see your seed companies.

  npx tsx fingerprint.ts --domains="a.com,b.com" --run=<slug>
  npx tsx fingerprint.ts --csv=seeds.csv --run=<slug>     (csv needs a \`domain\` column)

Writes <run>/fingerprint.json + fingerprint.csv. Requires PROSPEO_API_KEY.
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);

async function main() {
  let domains: string[] = [];
  if (args.domains) domains = String(args.domains).split(",").map(normDomain).filter(Boolean);
  else if (args.csv) domains = readCsv(String(args.csv)).map((r) => normDomain(r.domain)).filter(Boolean);
  if (!domains.length) { console.error("Provide --domains=a.com,b.com or --csv=file.csv (with `domain` column)"); process.exit(1); }
  domains = [...new Set(domains)];
  console.log(`Fingerprinting ${domains.length} domains → ${dir}`);

  // Homepages in parallel; Prospeo sequential (globally rate limited).
  const homepages = await mapConcurrent(domains, 5, (d) => fetchHomepageText(d).catch(() => ""));

  const prospeoRows: (Record<string, unknown> | null)[] = [];
  for (const d of domains) {
    const r = await prospeoSearch("search-company", { company: { websites: { include: [d] } } });
    prospeoRows.push(r.results.length ? prospeoCompanyRow(r.results[0]) : null);
  }

  const fingerprints = domains.map((domain, i) => {
    return {
      domain,
      prospeo_found: !!prospeoRows[i],
      prospeo_name: prospeoRows[i]?.name ?? "",
      prospeo_industry: prospeoRows[i]?.industry ?? "",
      prospeo_keywords: prospeoRows[i]?.keywords ?? "",
      prospeo_description: prospeoRows[i]?.description ?? "",
      prospeo_headcount: prospeoRows[i]?.employee_count ?? "",
      prospeo_state: prospeoRows[i]?.state ?? "",
      homepage_text: homepages[i],
    };
  });

  writeFileSync(join(dir, "fingerprint.json"), JSON.stringify(fingerprints, null, 2));
  writeCsv(join(dir, "fingerprint.csv"), fingerprints.map(({ homepage_text, ...rest }) => ({
    ...rest, homepage_excerpt: homepage_text.slice(0, 300),
  })));

  // Summary: industry coverage + which DBs miss which seeds
  const count = (vals: string[]) => {
    const m = new Map<string, number>();
    for (const v of vals.filter(Boolean)) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log(`\n== Coverage: Prospeo ${fingerprints.filter(f => f.prospeo_found).length}/${domains.length}, homepage ${fingerprints.filter(f => f.homepage_text).length}/${domains.length}`);
  console.log("\n== Prospeo industries across set:");
  for (const [v, n] of count(fingerprints.map(f => String(f.prospeo_industry)))) console.log(`  ${n}/${domains.length}  ${v}`);
  console.log("\n== Prospeo keywords across set (filter candidates):");
  const kws = fingerprints.flatMap(f => String(f.prospeo_keywords).split(";").map(k => k.trim()));
  for (const [v, n] of count(kws).slice(0, 25)) console.log(`  ${n}/${domains.length}  ${v}`);
  console.log("\n== Missing from Prospeo:", fingerprints.filter(f => !f.prospeo_found).map(f => f.domain).join(", ") || "none");
  console.log("   (that gap is the under-count story: good-fit companies the DB doesn't tag the obvious way)");
  console.log(`\nWrote ${join(dir, "fingerprint.json")} and fingerprint.csv`);
}

main().catch((e) => { console.error(e); process.exit(1); });
