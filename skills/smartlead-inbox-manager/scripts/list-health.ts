#!/usr/bin/env tsx
/**
 * Inbox health dashboard — prints summary + optional CSV.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/list-health.ts --all
 *   npx tsx scripts/list-health.ts --tag=insurance --out=health.csv
 *   npx tsx scripts/list-health.ts --filter=reputation:good --out=good-inboxes.csv
 *
 * Filters:
 *   --filter=reputation:good|fair|bad
 *   --filter=warmup:on|off
 *   --filter=health:healthy|warming|blocked
 */

import { writeFileSync } from "fs";
import { parseFlag, selectInboxes, hasFlag, InboxAccount } from "./_lib";

interface HealthRow {
  id: number;
  email: string;
  domain: string;
  tags: string;
  warmup: string;
  reputation: string;
  max_warmup_per_day: number;
  sent_today: number;
  is_blocked: boolean;
  smtp_ok: boolean;
  imap_ok: boolean;
  health_status: string;
}

function inboxToHealthRow(i: InboxAccount): HealthRow {
  const email = i.from_email || i.email || "";
  const domain = email.split("@")[1] || "";
  const warmup = i.warmup_details?.status;
  const warmupOn = warmup === "ACTIVE" || warmup === "ENABLED";
  const blocked = !!i.warmup_details?.is_warmup_blocked;
  const repRaw = String(i.warmup_details?.warmup_reputation ?? "");
  const reputation = repRaw
    ? repRaw.includes("100")
      ? "good"
      : Number(repRaw.replace(/\D/g, "")) >= 80
      ? "good"
      : Number(repRaw.replace(/\D/g, "")) >= 50
      ? "fair"
      : "bad"
    : warmupOn
    ? "unknown"
    : "n/a";
  let health_status = "healthy";
  if (!i.is_smtp_success || !i.is_imap_success) health_status = "connection_failed";
  else if (blocked) health_status = "blocked";
  else if (warmupOn && (i.warmup_details?.total_sent_count ?? 0) < 30) health_status = "warming";
  else if (!warmupOn) health_status = "active";
  return {
    id: i.id,
    email,
    domain,
    tags: (i.tags ?? []).map((t: any) => t.name).join(","),
    warmup: warmupOn ? "on" : "off",
    reputation,
    max_warmup_per_day: i.warmup_details?.max_email_per_day ?? 0,
    sent_today: i.daily_sent_count ?? 0,
    is_blocked: blocked,
    smtp_ok: !!i.is_smtp_success,
    imap_ok: !!i.is_imap_success,
    health_status,
  };
}

function applyFilter(row: HealthRow, filter: string): boolean {
  const [k, v] = filter.split(":");
  if (k === "reputation") return row.reputation === v;
  if (k === "warmup") return row.warmup === v;
  if (k === "health") return row.health_status === v;
  throw new Error(`Unknown filter: ${filter}`);
}

function toCsv(rows: HealthRow[]): string {
  const header = Object.keys(rows[0] ?? {
    id: "", email: "", domain: "", tags: "", warmup: "", reputation: "", max_warmup_per_day: "",
    sent_today: "", is_blocked: "", smtp_ok: "", imap_ok: "", health_status: "",
  });
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((h) => `"${String((row as any)[h]).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const out = parseFlag(args, "--out");
  const filter = parseFlag(args, "--filter");

  if (!hasFlag(args, "--all") && !parseFlag(args, "--tag") && !parseFlag(args, "--domain") && !parseFlag(args, "--ids")) {
    // default to --all for health dashboard
    args.push("--all");
  }

  const inboxes = await selectInboxes(args);
  let rows = inboxes.map(inboxToHealthRow);
  if (filter) rows = rows.filter((r) => applyFilter(r, filter));

  // Summary
  const total = rows.length;
  const warmupOn = rows.filter((r) => r.warmup === "on").length;
  const active = rows.filter((r) => r.warmup === "off").length;
  const blocked = rows.filter((r) => r.is_blocked).length;
  const failedConn = rows.filter((r) => !r.smtp_ok || !r.imap_ok).length;
  const repGood = rows.filter((r) => r.reputation === "good").length;
  const repFair = rows.filter((r) => r.reputation === "fair").length;
  const repBad = rows.filter((r) => r.reputation === "bad").length;

  console.log(`\nInbox Health Dashboard\n`);
  console.log(`Total inboxes: ${total}`);
  console.log(`  Warmup on:        ${warmupOn}`);
  console.log(`  Active (off):     ${active}`);
  console.log(`  Blocked:          ${blocked}`);
  console.log(`  Conn failed:      ${failedConn}`);
  console.log(`\nReputation:`);
  console.log(`  Good:  ${repGood}`);
  console.log(`  Fair:  ${repFair}`);
  console.log(`  Bad:   ${repBad}`);

  console.log(`\nAction items:`);
  if (blocked) console.log(`  - ${blocked} inboxes blocked — run /email-deliverability-audit`);
  if (repBad) console.log(`  - ${repBad} inboxes with bad reputation — consider pausing`);
  if (failedConn) console.log(`  - ${failedConn} inboxes with connection failures — reconnect or replace`);
  if (!blocked && !repBad && !failedConn) console.log(`  - None; everything looks healthy.`);

  if (out) {
    writeFileSync(out, toCsv(rows));
    console.log(`\nWrote CSV to ${out} (${rows.length} rows)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
