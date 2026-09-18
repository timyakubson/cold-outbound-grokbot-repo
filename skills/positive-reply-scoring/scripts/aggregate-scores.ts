#!/usr/bin/env tsx
/**
 * Aggregate classified replies into positive reply rate metrics.
 *
 * Input: JSON array of { lead_id, label, confidence?, reason? } from Claude classification.
 * Needs total_sent count — fetched via Smartlead campaign stats API.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/aggregate-scores.ts --replies=/tmp/classified-replies.json --campaign-id=12345
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const API_BASE = "https://server.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  const replies = get("--replies");
  const campaignId = get("--campaign-id");
  const out = get("--out");
  if (!replies || !campaignId) {
    console.error(
      "Usage: --replies=/tmp/classified-replies.json --campaign-id=12345 [--out=path]"
    );
    process.exit(1);
  }
  return { replies, campaignId, out };
}

const POSITIVE_LABELS = new Set([
  "positive_interested",
  "positive_soft",
  "positive_referral",
]);
const EXCLUDED_FROM_DENOMINATOR = new Set(["ooo", "bounce"]);

async function fetchCampaignStats(campaignId: string): Promise<{ sent: number }> {
  if (!API_KEY) throw new Error("SMARTLEAD_API_KEY not set");
  const url = new URL(`${API_BASE}/campaigns/${campaignId}/statistics`);
  url.searchParams.set("api_key", API_KEY);
  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  const data = await resp.json();
  const sent = data.sent_count ?? data.total_sent ?? data.sent ?? 0;
  return { sent: Number(sent) };
}

function pct(n: number, d: number): string {
  if (d === 0) return "0.00%";
  return `${((n / d) * 100).toFixed(2)}%`;
}

async function main() {
  const { replies: replyPath, campaignId, out } = parseArgs();
  const classified: { lead_id: string; label: string; confidence?: number; reason?: string }[] =
    JSON.parse(readFileSync(replyPath, "utf8"));

  const { sent } = await fetchCampaignStats(campaignId);

  const buckets: Record<string, number> = {};
  for (const r of classified) {
    buckets[r.label] = (buckets[r.label] ?? 0) + 1;
  }

  const totalReplies = classified.length;
  const excluded = Object.entries(buckets)
    .filter(([label]) => EXCLUDED_FROM_DENOMINATOR.has(label))
    .reduce((s, [, n]) => s + n, 0);
  const netReplies = totalReplies - excluded;
  const positive = Object.entries(buckets)
    .filter(([label]) => POSITIVE_LABELS.has(label))
    .reduce((s, [, n]) => s + n, 0);
  const hostile = buckets["negative_hostile"] ?? 0;
  const unsub = buckets["unsubscribe"] ?? 0;

  const report = {
    campaign_id: campaignId,
    generated_at: new Date().toISOString(),
    total_sent: sent,
    total_replies: totalReplies,
    net_replies: netReplies,
    excluded_ooo_bounce: excluded,
    buckets,
    positive_replies: positive,
    positive_reply_rate: sent ? positive / sent : 0,
    positive_share_of_replies: netReplies ? positive / netReplies : 0,
    hostile_rate: sent ? hostile / sent : 0,
    unsub_rate: sent ? unsub / sent : 0,
  };

  // Human-readable output
  console.log(`\nCampaign ${campaignId} — Positive Reply Scoring\n`);
  console.log(`Total sent:              ${sent.toLocaleString()}`);
  console.log(`Total replies:           ${totalReplies.toLocaleString()} (${pct(totalReplies, sent)})`);
  console.log(`  ooo/bounce (excluded):    ${excluded}`);
  console.log(`  Net replies:             ${netReplies}`);
  console.log(`\nBreakdown:`);
  const order = [
    "positive_interested",
    "positive_soft",
    "positive_referral",
    "neutral_question",
    "negative_notnow",
    "negative_notfit",
    "negative_hostile",
    "unsubscribe",
    "ooo",
    "bounce",
    "other",
  ];
  for (const label of order) {
    if (buckets[label] !== undefined) {
      console.log(`  ${label.padEnd(22)} ${String(buckets[label]).padStart(4)}`);
    }
  }
  console.log(`\nPositive reply rate:     ${pct(positive, sent)}  (${positive} / ${sent.toLocaleString()})`);
  console.log(`Positive % of replies:   ${pct(positive, netReplies)}  (${positive} / ${netReplies})`);
  console.log(`Negative hostile rate:   ${pct(hostile, sent)}`);
  console.log(`Unsub rate:              ${pct(unsub, sent)}`);

  console.log(`\nBenchmarks (B2B cold email):`);
  console.log(`  Good positive reply rate: ≥1%`);
  console.log(`  Great: ≥2%`);
  console.log(`  Hostile >0.3% or unsub >2% → deliverability risk, pause campaign`);

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(`\nWrote JSON report to ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
