#!/usr/bin/env tsx
/**
 * Blitz API — find contacts at companies by domain, write CSV.
 *
 * Usage:
 *   export BLITZ_API_KEY=xxx
 *   export BLITZ_BASE_URL=https://api.useblitz.com  (or whatever your region)
 *   npx tsx scripts/find-contacts.ts \
 *     --domains-file=restaurants.csv \
 *     --titles=owner,founder,ceo \
 *     --out=contacts.csv
 */

import { readFileSync, writeFileSync } from "fs";

const BLITZ_API_KEY = process.env.BLITZ_API_KEY;
const BLITZ_BASE_URL = process.env.BLITZ_BASE_URL ?? "https://api.useblitz.com";
if (!BLITZ_API_KEY) {
  console.error("Missing env: BLITZ_API_KEY");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    domainsFile: get("--domains-file"),
    titles: (get("--titles") ?? "owner,founder,ceo,president,cto,vp")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    out: get("--out") ?? "contacts.csv",
    concurrency: Number(get("--concurrency") ?? 10),
  };
}

function readDomains(path: string): string[] {
  const text = readFileSync(path, "utf8").trim();
  const lines = text.split("\n");
  const header = lines[0].split(",").map((c) => c.replace(/"/g, "").trim());
  // If first line looks like a CSV header with company_domain column
  const idx = header.indexOf("company_domain");
  if (idx >= 0) {
    return lines
      .slice(1)
      .map((l) => l.split(",")[idx]?.replace(/^"|"$/g, "").trim())
      .filter(Boolean);
  }
  // Otherwise treat as one-per-line
  return lines.map((l) => l.split(",")[0].trim()).filter(Boolean);
}

function cleanDomain(d: string): string {
  return d
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

async function blitzCompany(domain: string): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${BLITZ_BASE_URL}/api/enrichment/company`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BLITZ_API_KEY}`,
      },
      body: JSON.stringify({ domain }),
    });
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
  throw new Error(`exhausted retries for ${domain}`);
}

function matchesTitle(title: string, keywords: string[]): boolean {
  const t = title.toLowerCase();
  return keywords.some((kw) => t.includes(kw));
}

async function pool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch (e) {
        out[i] = { error: String(e) } as any;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

interface ContactRow {
  company_domain: string;
  first_name: string;
  last_name: string;
  job_title: string;
  linkedin_url: string;
  email: string;
  email_source: string;
  company_name: string;
  company_industry: string;
  company_headcount: string;
  company_phone: string;
}

function toCsv(rows: ContactRow[]): string {
  const headers = Object.keys(rows[0] ?? {
    company_domain: "",
    first_name: "",
    last_name: "",
    job_title: "",
    linkedin_url: "",
    email: "",
    email_source: "",
    company_name: "",
    company_industry: "",
    company_headcount: "",
    company_phone: "",
  });
  const out = [headers.join(",")];
  for (const r of rows) {
    out.push(
      headers
        .map((h) => {
          const v = (r as any)[h] ?? "";
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    );
  }
  return out.join("\n");
}

async function main() {
  const args = parseArgs();
  if (!args.domainsFile) {
    console.error("Usage: --domains-file=<path> [--titles=csv] [--out=path]");
    process.exit(1);
  }
  const rawDomains = readDomains(args.domainsFile);
  const domains = [...new Set(rawDomains.map(cleanDomain))].filter(Boolean);
  console.error(`Processing ${domains.length} unique domains (titles: ${args.titles.join(", ")})`);

  let processed = 0;
  const allRows: ContactRow[] = [];
  const results = await pool(domains, args.concurrency, async (domain) => {
    processed++;
    if (processed % 50 === 0) console.error(`  ${processed}/${domains.length}`);
    try {
      const data = await blitzCompany(domain);
      const company = data.company ?? {};
      const employees = (data.employees ?? []).filter((e: any) =>
        matchesTitle(e.title || "", args.titles)
      );
      return employees.map((e: any) => ({
        company_domain: domain,
        first_name: e.first_name || "",
        last_name: e.last_name || "",
        job_title: e.title || "",
        linkedin_url: e.linkedin_url || "",
        email: e.email || "",
        email_source: e.email ? "blitz" : "",
        company_name: company.name || "",
        company_industry: company.industry || "",
        company_headcount: String(company.headcount ?? ""),
        company_phone: company.phone || "",
      }));
    } catch (err) {
      console.error(`  ${domain}: ${String(err).slice(0, 120)}`);
      return [];
    }
  });

  for (const r of results) if (Array.isArray(r)) allRows.push(...r);

  writeFileSync(args.out, toCsv(allRows));
  const withEmail = allRows.filter((r) => r.email).length;
  console.error(`\nWrote ${args.out} — ${allRows.length} contacts (${withEmail} with email)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
