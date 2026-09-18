#!/usr/bin/env tsx
/**
 * Campaign + per-inbox sent + reply + bounce audit.
 *
 * Applies the 1% rule:
 *   - flag_low_reply = TRUE if sent >= 200 AND reply_rate < 1%
 *   - flag_high_bounce = TRUE if sent >= 50 AND bounce_rate > 3%
 *
 * Two output files:
 *   1. <out>-campaigns.csv — campaign-level aggregates (authoritative for 1% rule)
 *   2. <out>-inboxes.csv    — best-effort per-inbox stats from mailbox-statistics
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/audit-performance.ts --out=/tmp/audit/performance
 *   npx tsx scripts/audit-performance.ts --client-id=5560 --out=/tmp/audit/perf
 *   npx tsx scripts/audit-performance.ts --campaign-ids=12345,67890 --out=/tmp/audit/perf
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const API_BASE = "https://server.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;
if (!API_KEY) {
  console.error("Missing env: SMARTLEAD_API_KEY");
  process.exit(1);
}

const LOW_REPLY_THRESHOLD = 1.0; // percent
const LOW_REPLY_MIN_SENT = 200;
const HIGH_BOUNCE_THRESHOLD = 3.0;
const HIGH_BOUNCE_MIN_SENT = 50;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    clientId: get("--client-id"),
    out: get("--out") ?? "/tmp/audit/performance",
    maxCampaigns: get("--max-campaigns") ? Number(get("--max-campaigns")) : Infinity,
    campaignIds: get("--campaign-ids")?.split(",").map((s) => Number(s.trim())),
  };
}

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url);
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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

async function listCampaigns(clientId?: string): Promise<any[]> {
  const url = new URL(`${API_BASE}/campaigns`);
  url.searchParams.set("api_key", API_KEY!);
  if (clientId) url.searchParams.set("client_id", clientId);
  const data = await fetchJson(url.toString());
  return Array.isArray(data) ? data : data.data ?? [];
}

async function campaignAnalytics(id: number): Promise<any> {
  const url = `${API_BASE}/campaigns/${id}/analytics?api_key=${API_KEY}`;
  return fetchJson(url);
}

async function campaignMailboxStats(id: number): Promise<any[]> {
  const url = `${API_BASE}/campaigns/${id}/mailbox-statistics?api_key=${API_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : data.data ?? [];
}

async function campaignEmailAccounts(campaignId: number): Promise<any[]> {
  const url = `${API_BASE}/campaigns/${campaignId}/email-accounts?api_key=${API_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : data.data ?? [];
}

interface CampaignRow {
  campaign_id: number;
  name: string;
  status: string;
  sent: number;
  replies: number;
  bounces: number;
  reply_rate_pct: number;
  bounce_rate_pct: number;
  flag_low_reply: boolean;
  flag_high_bounce: boolean;
}

interface InboxRow {
  inbox_id: number;
  email: string;
  domain: string;
  sent: number;
  replies: number;
  bounces: number;
  reply_rate_pct: number;
  bounce_rate_pct: number;
  flag_low_reply: boolean;
  flag_high_bounce: boolean;
  campaigns: string;
}

function toCsv<T>(rows: T[], headers: string[]): string {
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      headers
        .map((h) => `"${String((r as any)[h] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
  }
  return lines.join("\n");
}

async function main() {
  const { clientId, out, maxCampaigns, campaignIds } = parseArgs();

  // 1. Pick campaigns
  let campaigns: any[];
  if (campaignIds?.length) {
    campaigns = campaignIds.map((id) => ({ id, name: `(campaign ${id})`, status: "N/A" }));
    console.error(`${campaigns.length} campaigns (from --campaign-ids)`);
  } else {
    const all = await listCampaigns(clientId);
    campaigns = all.filter((c) =>
      ["ACTIVE", "PAUSED", "COMPLETED"].includes(c.status)
    );
    if (isFinite(maxCampaigns)) campaigns = campaigns.slice(0, maxCampaigns);
    console.error(`${campaigns.length} active/paused/completed campaigns`);
  }

  // 2. Campaign-level aggregates (1% rule at campaign level)
  const campaignRows: CampaignRow[] = [];
  console.error("\n=== Campaign-level stats ===");
  for (let i = 0; i < campaigns.length; i++) {
    const c = campaigns[i];
    try {
      const a = await campaignAnalytics(c.id);
      const sent = Number(a.sent_count ?? 0);
      const replies = Number(a.reply_count ?? 0);
      const bounces = Number(a.bounce_count ?? 0);
      const replyRate = sent ? (replies / sent) * 100 : 0;
      const bounceRate = sent ? (bounces / sent) * 100 : 0;
      campaignRows.push({
        campaign_id: c.id,
        name: a.name || c.name || "",
        status: a.status || c.status || "",
        sent,
        replies,
        bounces,
        reply_rate_pct: Number(replyRate.toFixed(2)),
        bounce_rate_pct: Number(bounceRate.toFixed(2)),
        flag_low_reply: sent >= LOW_REPLY_MIN_SENT && replyRate < LOW_REPLY_THRESHOLD,
        flag_high_bounce: sent >= HIGH_BOUNCE_MIN_SENT && bounceRate > HIGH_BOUNCE_THRESHOLD,
      });
      if ((i + 1) % 10 === 0)
        console.error(`  ${i + 1}/${campaigns.length} analytics pulled`);
    } catch (err) {
      console.error(`  campaign ${c.id} analytics error: ${String(err).slice(0, 100)}`);
    }
  }
  campaignRows.sort((a, b) => b.sent - a.sent);

  // 3. Per-inbox aggregation (best-effort from mailbox-statistics + email-accounts)
  console.error("\n=== Per-inbox aggregation (best-effort) ===");
  const inboxAgg = new Map<
    number,
    { email: string; sent: number; replies: number; bounces: number; campaigns: Set<number> }
  >();
  const sampledCampaigns = campaignRows.filter((c) => c.sent > 0).slice(0, 50);
  // mailbox-statistics only returns recent events (capped ~20 rows) — use for recent per-inbox hints
  // For proper per-inbox aggregates across the whole campaign, campaign-level flagging is more reliable
  for (const c of sampledCampaigns) {
    try {
      const inboxes = await campaignEmailAccounts(c.campaign_id);
      for (const inb of inboxes) {
        if (!inboxAgg.has(inb.id)) {
          inboxAgg.set(inb.id, {
            email: inb.from_email || inb.email || "",
            sent: 0,
            replies: 0,
            bounces: 0,
            campaigns: new Set(),
          });
        }
        inboxAgg.get(inb.id)!.campaigns.add(c.campaign_id);
      }
      const stats = await campaignMailboxStats(c.campaign_id);
      for (const s of stats) {
        const id = s.email_account_id;
        if (id == null) continue;
        if (!inboxAgg.has(id)) {
          inboxAgg.set(id, {
            email: s.from_email || "",
            sent: 0,
            replies: 0,
            bounces: 0,
            campaigns: new Set(),
          });
        }
        const agg = inboxAgg.get(id)!;
        agg.sent += Number(s.sent_count ?? 0);
        agg.replies += Number(s.reply_count ?? 0);
        agg.bounces += Number(s.bounce_count ?? 0);
      }
    } catch (err) {
      console.error(`  campaign ${c.campaign_id} inbox aggregation error: ${String(err).slice(0, 100)}`);
    }
  }
  const inboxRows: InboxRow[] = [];
  for (const [id, agg] of inboxAgg) {
    const replyRate = agg.sent ? (agg.replies / agg.sent) * 100 : 0;
    const bounceRate = agg.sent ? (agg.bounces / agg.sent) * 100 : 0;
    inboxRows.push({
      inbox_id: id,
      email: agg.email,
      domain: agg.email.split("@")[1] || "",
      sent: agg.sent,
      replies: agg.replies,
      bounces: agg.bounces,
      reply_rate_pct: Number(replyRate.toFixed(2)),
      bounce_rate_pct: Number(bounceRate.toFixed(2)),
      flag_low_reply: agg.sent >= LOW_REPLY_MIN_SENT && replyRate < LOW_REPLY_THRESHOLD,
      flag_high_bounce: agg.sent >= HIGH_BOUNCE_MIN_SENT && bounceRate > HIGH_BOUNCE_THRESHOLD,
      campaigns: [...agg.campaigns].join("|"),
    });
  }
  inboxRows.sort((a, b) => b.sent - a.sent);

  // 4. Write CSVs
  mkdirSync(dirname(out), { recursive: true });
  const campaignHeaders = [
    "campaign_id",
    "name",
    "status",
    "sent",
    "replies",
    "bounces",
    "reply_rate_pct",
    "bounce_rate_pct",
    "flag_low_reply",
    "flag_high_bounce",
  ];
  writeFileSync(`${out}-campaigns.csv`, toCsv(campaignRows, campaignHeaders));
  const inboxHeaders = [
    "inbox_id",
    "email",
    "domain",
    "sent",
    "replies",
    "bounces",
    "reply_rate_pct",
    "bounce_rate_pct",
    "flag_low_reply",
    "flag_high_bounce",
    "campaigns",
  ];
  writeFileSync(`${out}-inboxes.csv`, toCsv(inboxRows, inboxHeaders));

  // 5. Summary
  const totalSent = campaignRows.reduce((s, c) => s + c.sent, 0);
  const totalReplies = campaignRows.reduce((s, c) => s + c.replies, 0);
  const totalBounces = campaignRows.reduce((s, c) => s + c.bounces, 0);
  const fleetReply = totalSent ? (totalReplies / totalSent) * 100 : 0;
  const fleetBounce = totalSent ? (totalBounces / totalSent) * 100 : 0;
  const camp1pct = campaignRows.filter((c) => c.flag_low_reply).length;
  const campHiBounce = campaignRows.filter((c) => c.flag_high_bounce).length;
  const inb1pct = inboxRows.filter((r) => r.flag_low_reply).length;

  console.log(`\n=== Fleet Performance Summary ===\n`);
  console.log(`Campaigns audited:       ${campaignRows.length}`);
  console.log(`Total sent:              ${totalSent.toLocaleString()}`);
  console.log(`Total replies:           ${totalReplies.toLocaleString()}`);
  console.log(`Total bounces:           ${totalBounces.toLocaleString()}`);
  console.log(`Fleet reply rate:        ${fleetReply.toFixed(2)}%  ${fleetReply >= 1 ? "PASS" : "FAIL (below 1%)"}`);
  console.log(`Fleet bounce rate:       ${fleetBounce.toFixed(2)}%  ${fleetBounce <= 2 ? "PASS" : "FAIL (above 2%)"}`);
  console.log(`\nCampaigns failing 1% rule (≥200 sent, <1% reply):   ${camp1pct}`);
  console.log(`Campaigns with bounce >3% (≥50 sent):                  ${campHiBounce}`);
  console.log(`Inboxes (aggregated) failing 1% rule:                  ${inb1pct}`);

  const offenders = campaignRows.filter((c) => c.flag_low_reply).slice(0, 10);
  if (offenders.length) {
    console.log(`\nTop campaigns failing the 1% rule:`);
    console.log(`id       sent     reply%   name`);
    for (const o of offenders) {
      console.log(
        `${String(o.campaign_id).padEnd(8)} ${String(o.sent).padStart(5)}    ${String(o.reply_rate_pct).padStart(5)}%   ${o.name.slice(0, 60)}`
      );
    }
  }

  console.log(`\nOutputs:`);
  console.log(`  ${out}-campaigns.csv  (authoritative — use this for 1% rule)`);
  console.log(`  ${out}-inboxes.csv    (best-effort per-inbox aggregation)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
