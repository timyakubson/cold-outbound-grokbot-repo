#!/usr/bin/env tsx
/**
 * Create + poll + pull a Smartlead Smart Delivery spam placement test.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/run-spam-test.ts --campaign-id=12345 --senders=100 --out=/tmp/spam-test.json
 *
 * Notes:
 *   - Only 2 provider pools are available: G Suite (20) and Office365 (21).
 *   - ~500 seed cap per test; stay under ~300 senders to avoid stalls.
 *   - is_warmup MUST be true or test truncates at ~9%.
 *   - Takes 5-20 minutes to complete.
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const SERVER_BASE = "https://server.smartlead.ai/api/v1";
const DELIVERY_BASE = "https://smartdelivery.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;
if (!API_KEY) {
  console.error("Missing env: SMARTLEAD_API_KEY");
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  const campaignId = get("--campaign-id");
  const senders = Number(get("--senders") ?? 100);
  const out = get("--out") ?? "/tmp/spam-test.json";
  const testName = get("--name") ?? `audit-${new Date().toISOString().slice(0, 10)}`;
  if (!campaignId) {
    console.error("Usage: --campaign-id=12345 [--senders=100] [--out=path]");
    process.exit(1);
  }
  return { campaignId, senders, out, testName };
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  return resp.json();
}

async function main() {
  const { campaignId, senders: maxSenders, out, testName } = parseArgs();

  // 1. Pull campaign sender accounts
  console.error(`Fetching senders for campaign ${campaignId}...`);
  const accts = await fetchJson(
    `${SERVER_BASE}/campaigns/${campaignId}/email-accounts?api_key=${API_KEY}`
  );
  if (!Array.isArray(accts) || !accts.length) {
    throw new Error(`No email accounts on campaign ${campaignId}`);
  }
  const senderFromEmails = accts
    .map((a: any) => a.from_email)
    .filter(Boolean)
    .slice(0, maxSenders);
  console.error(`  Using ${senderFromEmails.length} senders (campaign has ${accts.length})`);

  // 2. Pull sequences to get sequence_mapping_id
  console.error("Fetching campaign sequences...");
  const seqData = await fetchJson(
    `${SERVER_BASE}/campaigns/${campaignId}/sequences?api_key=${API_KEY}`
  );
  const sequences = Array.isArray(seqData) ? seqData : seqData.sequences;
  if (!sequences?.length) throw new Error("Campaign has no sequences");
  const sequenceMappingId = sequences[0].id;
  console.error(`  Using sequence_mapping_id=${sequenceMappingId}`);

  // 3. Create spam test
  console.error("Creating spam test...");
  const createBody = {
    test_name: testName,
    description: `Deliverability audit for campaign ${campaignId}`,
    campaign_id: Number(campaignId),
    sequence_mapping_id: sequenceMappingId,
    sender_accounts: senderFromEmails,
    provider_ids: [20, 21],
    spam_filters: ["spam_assassin"],
    link_checker: true,
    all_email_sent_without_time_gap: false,
    min_time_btwn_emails: 1,
    min_time_unit: "minutes",
    is_warmup: true,
  };
  const created = await fetchJson(
    `${DELIVERY_BASE}/spam-test/manual?api_key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
    }
  );
  const testId = created.id || created.spamTestId;
  console.error(`  Test created: id=${testId}`);

  // 4. Poll for completion (max 25 min)
  console.error("Polling for completion (up to 25 min)...");
  const start = Date.now();
  let status: string | undefined;
  while (Date.now() - start < 25 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 30000));
    const detail = await fetchJson(`${DELIVERY_BASE}/spam-test/${testId}?api_key=${API_KEY}`);
    status = detail.status;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.error(`  [${elapsed}s] status=${status} test_end_date=${detail.test_end_date}`);
    if (detail.test_end_date || status !== "ACTIVE") break;
  }

  // 5. Pull reports
  console.error("Fetching reports...");
  const reports = {
    providerwise: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/providerwise?api_key=${API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    ).catch((e) => ({ error: String(e) })),
    groupwise: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/groupwise?api_key=${API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
    ).catch((e) => ({ error: String(e) })),
    senderWise: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/sender-account-wise?api_key=${API_KEY}`
    ).catch((e) => ({ error: String(e) })),
    spamFilterDetails: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/spam-filter-details?api_key=${API_KEY}`
    ).catch((e) => ({ error: String(e) })),
    dkim: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/dkim-details?api_key=${API_KEY}`
    ).catch((e) => ({ error: String(e) })),
    spf: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/spf-details?api_key=${API_KEY}`
    ).catch((e) => ({ error: String(e) })),
    blacklist: await fetchJson(
      `${DELIVERY_BASE}/spam-test/report/${testId}/blacklist?api_key=${API_KEY}`
    ).catch((e) => ({ error: String(e) })),
  };

  const payload = { test_id: testId, status, create_body: createBody, reports };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.error(`\nWrote ${out}`);

  // Summary
  const pw = reports.providerwise;
  if (pw && !pw.error) {
    console.error("\n--- Placement summary ---");
    console.error(JSON.stringify(pw, null, 2).slice(0, 800));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
