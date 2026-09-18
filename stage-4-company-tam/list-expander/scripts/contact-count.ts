#!/usr/bin/env tsx
/**
 * Phase 5a — Verified-email contact ceiling. Given the qualified company CSV
 * and target titles/seniorities, uses the free Prospeo count trick
 * (person_contact_details.email=["VERIFIED"] → pagination.total_count) to
 * size the contactable TAM. Batches domains 500 at a time (company.websites max).
 *
 * Usage:
 *   npx tsx contact-count.ts --csv=qualified.csv --run=medical-groups \
 *     [--titles="COO,Chief Operating Officer,VP Operations,Practice Administrator"] \
 *     [--seniorities="C-Suite,Vice President,Head,Director"]
 */
import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { loadEnv, parseArgs, readCsv, normDomain, outDir, prospeoCount, maybeHelp } from "./lib";

maybeHelp(`
contact-count.ts — Phase 5a: verified-email contact ceiling for a qualified company list.

  npx tsx contact-count.ts --csv=qualified.csv --run=<slug> \\
    [--titles="COO,VP Operations,Practice Administrator"] \\
    [--seniorities="C-Suite,Vice President,Head,Director"]

Uses the free Prospeo page-1 count trick, 500 domains per call. Requires PROSPEO_API_KEY.
Seniority enum: Founder/Owner, C-Suite, Partner, Vice President, Head, Director,
Manager, Senior, Entry, Intern (never "VP", never "President").
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);

async function main() {
  const csvPath = String(args.csv ?? "");
  if (!csvPath || !existsSync(csvPath)) { console.error("Need --csv=<qualified.csv> (a readable CSV with a `domain` column). Pass --help for usage."); process.exit(1); }
  const domains = [...new Set(readCsv(csvPath).map((r) => normDomain(r.domain)).filter(Boolean))];
  if (!domains.length) { console.error(`No usable \`domain\` values in ${csvPath}`); process.exit(1); }
  const person: Record<string, unknown> = {};
  if (args.titles) person.person_job_title = { include: String(args.titles).split(",").map((s) => s.trim()), match_mode: "CONTAINS" };
  if (args.seniorities) person.person_seniority = { include: String(args.seniorities).split(",").map((s) => s.trim()) };

  let totalAll = 0, totalVerified = 0;
  const batches: { size: number; all: number | null; verified: number | null }[] = [];
  for (let i = 0; i < domains.length; i += 500) {
    const batch = domains.slice(i, i + 500);
    const base = { company: { websites: { include: batch } }, ...person };
    const all = await prospeoCount("search-person", base);
    const verified = await prospeoCount("search-person", { ...base, person_contact_details: { email: ["VERIFIED"] } });
    totalAll += all ?? 0; totalVerified += verified ?? 0;
    batches.push({ size: batch.length, all, verified });
    console.log(`  batch ${i / 500 + 1} (${batch.length} domains): people=${all} verified-email=${verified}`);
  }
  const result = { domains: domains.length, titles: args.titles ?? null, seniorities: args.seniorities ?? null, total_people: totalAll, total_verified_email: totalVerified, batches };
  writeFileSync(join(dir, "contact-count.json"), JSON.stringify(result, null, 2));
  console.log(`\n${domains.length} companies → ${totalAll} matching people, ${totalVerified} with VERIFIED email → ${join(dir, "contact-count.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
