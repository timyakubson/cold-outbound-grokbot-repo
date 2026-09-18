#!/usr/bin/env tsx
/**
 * Phase 4 merge — normalize contact pulls from any provider into one deduped file.
 * NO CAPS: every matching person at every company is kept.
 *
 * Usage:
 *   npx tsx contacts-merge.ts --run=<slug> \
 *     --csv=getleads-export.csv:getleads --csv=blitz-contacts.csv:blitz [--csv=prospeo.csv:prospeo]
 *
 * Each input keeps ALL original columns inside raw_json (max data retention).
 * Provider emails land in provider_email (+ provider_email_status). contacts.ts
 * turns these into leads-final.csv; validate with MillionVerifier before sending.
 * Dedup key: linkedin_url when present, else domain|first|last (lowercased).
 * Output: ~/output/list-builder/<run>/contacts-merged.csv
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
// Reuse the list-expander shared lib (csv + domain helpers)
import { parseArgs, readCsv, writeCsv, normDomain } from "../../list-expander/scripts/lib";

const args = parseArgs();
const run = String(args.run ?? "default");
const dir = join(homedir(), "output", "list-builder", run);
mkdirSync(dir, { recursive: true });

// Header aliases per provider → normalized fields
const ALIASES: Record<string, string[]> = {
  first_name: ["first_name", "First Name", "firstname", "first"],
  last_name: ["last_name", "Last Name", "lastname", "last"],
  full_name: ["full_name", "name", "Full Name", "contact_name"],
  job_title: ["job_title", "title", "Job Title", "Current Job Title", "position", "headline"],
  seniority: ["seniority", "Seniority", "Seniority Level"],
  linkedin_url: ["linkedin_url", "linkedin", "LinkedIn Url", "Linkedin Url", "Contact LinkedIn URL", "person_linkedin_url", "li_url"],
  domain: ["domain", "company_domain", "Company Domain", "website", "company_website"],
  company_name: ["company_name", "company", "Company Name", "organization"],
  provider_email: ["email", "Email", "work_email", "email_address"],
  provider_email_status: ["email_status", "Email Status", "Email Verification Status", "verification_status"],
  phone: ["phone", "mobile", "phone_number", "Mobile Phone", "Cellphone"],
  city: ["city", "City", "locality", "Contact City"],
  state: ["state", "State", "region", "Contact State"],
  country: ["country", "Country", "Contact Country"],
};

function pick(row: Record<string, string>, field: string): string {
  for (const a of ALIASES[field]) if (row[a] != null && row[a] !== "") return row[a];
  return "";
}

function normLi(url: string): string {
  return (url || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "https://www.").replace(/\/+$/, "");
}

const inputs = (Array.isArray(args.csv) ? args.csv : [args.csv]).filter(Boolean) as string[];
// parseArgs keeps last --csv only; also accept comma-separated and repeated via argv scan
const specs: { path: string; provider: string }[] = [];
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--csv=(.+):([a-z0-9_-]+)$/i);
  if (m) specs.push({ path: m[1], provider: m[2].toLowerCase() });
}
if (!specs.length) { console.error("Usage: --run=<slug> --csv=<file>:<provider> [--csv=...:...]"); process.exit(1); }

const merged = new Map<string, Record<string, unknown>>();
let total = 0;
for (const { path, provider } of specs) {
  const rows = readCsv(path);
  total += rows.length;
  for (const r of rows) {
    const li = normLi(pick(r, "linkedin_url"));
    const domain = normDomain(pick(r, "domain"));
    const first = pick(r, "first_name") || pick(r, "full_name").split(" ")[0] || "";
    const last = pick(r, "last_name") || pick(r, "full_name").split(" ").slice(1).join(" ") || "";
    const key = li || `${domain}|${first.toLowerCase()}|${last.toLowerCase()}`;
    if (!domain && !li) continue;
    const rec = {
      first_name: first, last_name: last,
      job_title: pick(r, "job_title"), seniority: pick(r, "seniority"),
      linkedin_url: li, domain, company_name: pick(r, "company_name"),
      provider_email: pick(r, "provider_email"), provider_email_status: pick(r, "provider_email_status"),
      phone: pick(r, "phone"), city: pick(r, "city"), state: pick(r, "state"), country: pick(r, "country"),
      providers: provider,
      raw_json: JSON.stringify({ [provider]: r }),
    };
    const prev = merged.get(key);
    if (!prev) merged.set(key, rec);
    else {
      // enrich blanks from later providers; merge raw_json; record all providers
      for (const [k, v] of Object.entries(rec)) if (k !== "raw_json" && k !== "providers" && !prev[k] && v) prev[k] = v;
      prev.providers = [...new Set(`${prev.providers}+${provider}`.split("+"))].join("+");
      const raw = JSON.parse(String(prev.raw_json)); raw[provider] = JSON.parse(String(rec.raw_json))[provider];
      prev.raw_json = JSON.stringify(raw);
    }
  }
  console.log(`  ${provider}: ${rows.length} rows in (${merged.size} unique so far)`);
}

const out = join(dir, "contacts-merged.csv");
writeCsv(out, [...merged.values()]);
const withLi = [...merged.values()].filter((r) => r.linkedin_url).length;
console.log(`\n${merged.size} unique contacts from ${total} input rows → ${out}`);
console.log(`${withLi} have LinkedIn URLs; ${merged.size - withLi} without.`);
console.log("Next: contacts.ts writes leads-final.csv from provider emails; validate with MillionVerifier before upload.");
