#!/usr/bin/env tsx
/**
 * Pull inbox inventory from Smartlead and write to CSV.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/audit-inboxes.ts --all --out=/tmp/audit/inboxes.csv
 *   npx tsx scripts/audit-inboxes.ts --tag=active --out=/tmp/audit/active.csv
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const API_BASE = "https://server.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;
if (!API_KEY) {
  console.error("Missing env var: SMARTLEAD_API_KEY");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    all: args.includes("--all"),
    tag: get("--tag"),
    domain: get("--domain"),
    maxInboxes: get("--max-inboxes") ? Number(get("--max-inboxes")) : Infinity,
    out: get("--out") ?? "/tmp/audit/inboxes.csv",
  };
}

async function listAll(maxInboxes: number = Infinity): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const url = `${API_BASE}/email-accounts?api_key=${API_KEY}&offset=${offset}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${resp.status}: ${await resp.text().catch(() => "")}`);
    const batch = await resp.json();
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    console.error(`  offset=${offset} total_so_far=${all.length}`);
    if (all.length >= maxInboxes) {
      all.length = Math.min(all.length, maxInboxes);
      break;
    }
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

function rowFor(i: any) {
  const email = i.from_email || i.email || "";
  const domain = email.split("@")[1] || "";
  const w = i.warmup_details ?? {};
  return {
    id: i.id,
    email,
    domain,
    from_name: i.from_name || "",
    tags: (i.tags ?? []).map((t: any) => t.name).join("|"),
    warmup_status: w.status ?? "",
    warmup_reputation: w.warmup_reputation ?? "",
    max_warmup_per_day: w.max_email_per_day ?? "",
    total_warmup_sent: w.total_sent_count ?? "",
    is_warmup_blocked: !!w.is_warmup_blocked,
    message_per_day: i.message_per_day ?? "",
    daily_sent_count: i.daily_sent_count ?? 0,
    is_smtp_success: !!i.is_smtp_success,
    is_imap_success: !!i.is_imap_success,
    smtp_host: i.smtp_host ?? "",
    client_id: i.client_id ?? "",
  };
}

async function main() {
  const { all: wantAll, tag, domain, out, maxInboxes } = parseArgs();
  let inboxes = await listAll(maxInboxes);
  if (tag) inboxes = inboxes.filter((i) => (i.tags ?? []).some((t: any) => t.name === tag));
  if (domain)
    inboxes = inboxes.filter((i) => (i.from_email || i.email || "").endsWith(`@${domain}`));
  if (!wantAll && !tag && !domain) {
    console.error("Provide --all, --tag=..., or --domain=...");
    process.exit(1);
  }
  const rows = inboxes.map(rowFor);
  if (!rows.length) {
    console.error("No inboxes matched.");
    return;
  }
  const header = Object.keys(rows[0]);
  const csv = [header.join(",")];
  for (const r of rows) {
    csv.push(header.map((h) => `"${String((r as any)[h]).replace(/"/g, '""')}"`).join(","));
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv.join("\n"));
  console.error(`Wrote ${out} — ${rows.length} inboxes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
