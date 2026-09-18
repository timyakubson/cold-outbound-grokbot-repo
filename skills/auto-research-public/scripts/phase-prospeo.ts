#!/usr/bin/env tsx
/**
 * Phase 3: Prospeo search.
 *
 * Takes Prospeo filters JSON, runs paginated search, outputs leads JSON.
 *
 * Usage:
 *   export PROSPEO_API_KEY=xxx
 *   npx tsx scripts/phase-prospeo.ts --filters-file=/tmp/auto/filters.json --max-leads=1000 --out=/tmp/auto/leads.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const API_KEY = process.env.PROSPEO_API_KEY;
if (!API_KEY) {
  console.error("Missing env: PROSPEO_API_KEY");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    filtersFile: get("--filters-file"),
    maxLeads: Number(get("--max-leads") ?? 1000),
    maxPages: Number(get("--max-pages") ?? 40),
    out: get("--out") ?? "/tmp/auto/leads.json",
  };
}

interface Lead {
  first_name: string;
  last_name: string;
  email: string;
  linkedin_url: string;
  job_title: string;
  company_name: string;
  company_domain: string;
  company_industry: string;
  company_headcount: number;
  company_location: string;
  company_description: string;
}

async function main() {
  const { filtersFile, maxLeads, maxPages, out } = parseArgs();
  if (!filtersFile) {
    console.error("Usage: --filters-file=path [--max-leads=1000] [--max-pages=40] [--out=path]");
    process.exit(1);
  }
  const filters = JSON.parse(readFileSync(filtersFile, "utf8"));

  const all: Lead[] = [];
  console.error(`[Prospeo] Searching up to ${maxPages} pages / ${maxLeads} leads...`);

  for (let page = 1; page <= maxPages; page++) {
    const resp = await fetch("https://api.prospeo.io/search-person", {
      method: "POST",
      headers: { "X-KEY": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ page, filters }),
    });
    const data = await resp.json();
    if (page === 1) {
      console.error(`[Prospeo] Total available: ${data.pagination?.total_count ?? "?"}`);
    }
    if (data.error_code === "INVALID_FILTERS") {
      console.error(`[Prospeo] Filter error: ${data.filter_error || "unknown"}`);
      break;
    }
    const results: Lead[] = (data.results ?? []).map((r: any) => ({
      first_name: r.person?.first_name || "",
      last_name: r.person?.last_name || "",
      email: (() => {
        const e = r.person?.email;
        if (typeof e === "string") return e;
        if (e?.email && e.revealed !== false && !e.email.includes("*")) return e.email;
        return "";
      })(),
      linkedin_url: r.person?.linkedin_url || "",
      job_title: r.person?.current_job_title || "",
      company_name: r.company?.name || "",
      company_domain: r.company?.domain || "",
      company_industry: r.company?.industry || "",
      company_headcount: r.company?.headcount || 0,
      company_location: r.company?.location?.state || r.company?.location?.country || "",
      company_description:
        r.company?.description || r.company?.description_ai || "",
    }));
    all.push(...results);
    if (page % 10 === 0) console.error(`[Prospeo] Page ${page}: ${all.length} total leads`);
    if (results.length < 25) break;
    if (all.length >= maxLeads) break;
    await new Promise((r) => setTimeout(r, 450));
  }

  const leads = all.slice(0, maxLeads);
  const withEmail = leads.filter((l) => l.email.includes("@")).length;
  const withDesc = leads.filter((l) => l.company_description.length > 50).length;

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ leads, stats: { total: leads.length, withEmail, withDesc } }, null, 2)
  );
  console.error(`\nWrote ${out} — ${leads.length} leads (${withEmail} with email, ${withDesc} with desc)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
