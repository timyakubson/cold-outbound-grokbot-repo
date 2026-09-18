#!/usr/bin/env tsx
/**
 * DiscoLike lookalike discovery.
 *
 * Usage:
 *   export DISCOLIKE_API_KEY=xxx
 *   npx tsx scripts/discover.ts --domains="clay.com,apollo.io" --country=US --limit=500 --out=lookalikes.csv
 *   npx tsx scripts/discover.ts --text="B2B cold email outreach" --out=lookalikes.csv
 *   npx tsx scripts/discover.ts --domains="..." --negation-domains="..." --max-companies=1000 --out=...
 */

import { writeFileSync } from "fs";

const DISCOLIKE_BASE = "https://api.discolike.com/v1";
const API_KEY = process.env.DISCOLIKE_API_KEY;
if (!API_KEY) {
  console.error("Missing env: DISCOLIKE_API_KEY");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    domains: get("--domains"),
    text: get("--text"),
    negationDomains: get("--negation-domains"),
    country: get("--country"),
    limit: Number(get("--limit") ?? 100),
    maxCompanies: Number(get("--max-companies") ?? 500),
    out: get("--out") ?? "lookalikes.csv",
  };
}

interface DiscoLikeCompany {
  domain: string;
  name?: string;
  description?: string;
  industry_groups?: Record<string, number>;
  employees?: string;
  address?: { country?: string; state?: string; city?: string };
  social_urls?: string[];
}

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url, { headers: { "x-discolike-key": API_KEY! } });
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`${resp.status}: ${t.slice(0, 200)}`);
    }
    return resp.json();
  }
  throw new Error("exhausted retries");
}

function buildParams(args: ReturnType<typeof parseArgs>, offset: number): string {
  const p = new URLSearchParams();
  if (args.domains) p.set("domains", args.domains);
  if (args.text) p.set("text", args.text);
  if (args.negationDomains) p.set("negation_domains", args.negationDomains);
  if (args.country) p.set("country", args.country);
  p.set("limit", String(args.limit));
  if (offset) p.set("offset", String(offset));
  return p.toString();
}

function topIndustry(groups: Record<string, number> | undefined): string {
  if (!groups) return "";
  const entries = Object.entries(groups);
  if (!entries.length) return "";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function parseEmployeeMidpoint(e: string | undefined): number | "" {
  if (!e) return "";
  const m: Record<string, number> = {
    "1-10": 5,
    "11-50": 30,
    "51-200": 125,
    "201-500": 350,
    "501-1000": 750,
    "1001-5000": 3000,
    "5001-10000": 7500,
    "10001+": 15000,
  };
  return m[e] ?? "";
}

async function main() {
  const args = parseArgs();
  if (!args.domains && !args.text) {
    console.error("Usage: --domains=a,b OR --text='...'  (at least one required)");
    process.exit(1);
  }

  // Count first
  try {
    const countUrl = `${DISCOLIKE_BASE}/count?${buildParams(args, 0)}`;
    const { count } = await fetchJson(countUrl);
    console.error(`[DiscoLike] Universe size: ${Number(count).toLocaleString()}`);
  } catch (err) {
    console.error(`[DiscoLike] Count check failed, proceeding anyway: ${String(err).slice(0, 100)}`);
  }

  const rows: any[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let apiCalls = 0;

  while (rows.length < args.maxCompanies && offset < 10000) {
    const url = `${DISCOLIKE_BASE}/discover?${buildParams(args, offset)}`;
    const batch: DiscoLikeCompany[] = await fetchJson(url);
    apiCalls++;
    if (!batch.length) break;

    for (const c of batch) {
      const d = c.domain?.toLowerCase();
      if (!d || seen.has(d)) continue;
      seen.add(d);
      const linkedin = (c.social_urls ?? []).find((u) => u.includes("linkedin.com/company")) ?? "";
      rows.push({
        domain: d,
        company_name: c.name || "",
        industry: topIndustry(c.industry_groups),
        headcount_range: c.employees || "",
        headcount: parseEmployeeMidpoint(c.employees),
        location_country: c.address?.country || "",
        location_state: c.address?.state || "",
        location_city: c.address?.city || "",
        linkedin_url: linkedin,
        description: (c.description || "").slice(0, 500),
        source: "discolike",
      });
      if (rows.length >= args.maxCompanies) break;
    }

    console.error(`[DiscoLike] offset=${offset} returned=${batch.length} new_total=${rows.length}`);
    if (batch.length < args.limit) break;
    offset += args.limit;
  }

  const estCost = apiCalls * 0.1 + (rows.length / 1000) * 2.0;
  console.error(`\n[DiscoLike] Done: ${rows.length} new companies, ${apiCalls} API calls (est. ~$${estCost.toFixed(2)})`);

  // Write CSV
  const headers = [
    "domain",
    "company_name",
    "industry",
    "headcount_range",
    "headcount",
    "location_country",
    "location_state",
    "location_city",
    "linkedin_url",
    "description",
    "source",
  ];
  const csv = [headers.join(",")];
  for (const r of rows) {
    csv.push(headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  writeFileSync(args.out, csv.join("\n"));
  console.error(`Wrote ${args.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
