#!/usr/bin/env tsx
/**
 * Phase 7: Smartlead campaign creation + upload.
 *
 * Self-contained version of the GEX v2 campaign-launcher, with:
 * - Inbox selection via Smartlead tags (no Supabase)
 * - Local JSON state (no auto_research_inbox_assignments table)
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/phase-upload.ts \
 *     --leads-file=/tmp/auto/personalized.json \
 *     --variants-file=/tmp/auto/variants.json \
 *     --domain=target.com \
 *     --inboxes-tag=active \
 *     --inbox-count=10 \
 *     --activate
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const SL_BASE = "https://server.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;
if (!API_KEY) {
  console.error("Missing env: SMARTLEAD_API_KEY");
  process.exit(1);
}
const LEADS_BATCH = 100;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    leadsFile: get("--leads-file"),
    variantsFile: get("--variants-file"),
    domain: get("--domain"),
    inboxTag: get("--inboxes-tag") ?? "active",
    inboxCount: Number(get("--inbox-count") ?? 10),
    clientId: get("--client-id"),
    experimentLog: get("--experiment-log"),
    activate: args.includes("--activate"),
  };
}

async function slGet(path: string, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(SL_BASE + path);
  url.searchParams.set("api_key", API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`GET ${path}: ${resp.status} ${await resp.text().catch(() => "")}`);
  return resp.json();
}
async function slPost(path: string, body: any, params: Record<string, any> = {}): Promise<any> {
  const url = new URL(SL_BASE + path);
  url.searchParams.set("api_key", API_KEY!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`POST ${path}: ${resp.status} ${await resp.text().catch(() => "")}`);
  return resp.json();
}

async function selectInboxesByTag(tag: string, count: number): Promise<{ id: number; email: string }[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const batch = await slGet("/email-accounts", { offset, limit: 100 });
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  const tagged = all.filter(
    (i: any) =>
      (i.tags ?? []).some((t: any) => t.name === tag) &&
      i.is_smtp_success &&
      !i.warmup_details?.is_warmup_blocked
  );
  // LRU-ish: lowest daily_sent_count first
  tagged.sort((a, b) => (a.daily_sent_count ?? 0) - (b.daily_sent_count ?? 0));
  return tagged.slice(0, count).map((i: any) => ({ id: i.id, email: i.from_email || i.email }));
}

function buildBody(variantLabel: string, campaignId: number, bodyTemplate?: string): string {
  const v = variantLabel.toLowerCase();
  if (bodyTemplate) {
    // Replace placeholders with campaign-ID-scoped variants
    return bodyTemplate
      .replace(/\{\{situation_line\}\}/g, `{{situation_line_${v}_${campaignId}}}`)
      .replace(/\{\{value_line\}\}/g, `{{value_line_${v}_${campaignId}}}`)
      .replace(/\{\{cta_line\}\}/g, `{{cta_line_${v}_${campaignId}}}`);
  }
  return `Hi {{first_name}},<br><br>{{situation_line_${v}_${campaignId}}}<br><br>{{value_line_${v}_${campaignId}}}<div><br></div>{{cta_line_${v}_${campaignId}}}<br><br>%signature%<br><br>P.S. If this isn't relevant, just let me know and I won't reach out again.`;
}

async function main() {
  const args = parseArgs();
  if (!args.leadsFile || !args.variantsFile || !args.domain) {
    console.error(
      "Usage: --leads-file=... --variants-file=... --domain=... [--inboxes-tag=active] [--inbox-count=10] [--activate]"
    );
    process.exit(1);
  }

  const leads: any[] = JSON.parse(readFileSync(args.leadsFile, "utf8"));
  const variants: any[] = JSON.parse(readFileSync(args.variantsFile, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const campaignName = `[AUTO] ${today} ${args.domain}`;

  console.error(`\n[Launch] Creating campaign: ${campaignName}`);
  console.error(`  Leads: ${leads.length} | Variants: ${variants.length}`);

  // 1. Create campaign
  const createBody: any = { name: campaignName };
  if (args.clientId) createBody.client_id = Number(args.clientId);
  const campaign = await slPost("/campaigns/create", createBody);
  const campaignId = campaign.id;
  console.error(`  Campaign created: #${campaignId}`);

  // 2. Save sequences with A/B/C variants
  await slPost(`/campaigns/${campaignId}/sequences`, {
    sequences: [
      {
        seq_number: 1,
        seq_delay_details: { delay_in_days: 0 },
        seq_variants: variants.map((v: any) => ({
          variant_label: v.variant,
          subject: (v.subject || "").replace(/—/g, " - ").replace(/–/g, " - "),
          email_body: buildBody(v.variant, campaignId, v.body_template),
        })),
      },
    ],
  });
  console.error(`  Saved ${variants.length} variants`);

  // 3. Select + add inboxes
  const inboxes = await selectInboxesByTag(args.inboxTag, args.inboxCount);
  if (!inboxes.length) throw new Error(`No inboxes matching tag=${args.inboxTag}`);
  let remainingIds = inboxes.map((i) => i.id);
  let retries = 0;
  while (remainingIds.length && retries < 50) {
    try {
      await slPost(`/campaigns/${campaignId}/email-accounts`, { email_account_ids: remainingIds });
      break;
    } catch (err: any) {
      const m = err.message?.match(/Email account id - (\d+) not allowed/);
      if (m) {
        const bad = Number(m[1]);
        remainingIds = remainingIds.filter((id) => id !== bad);
        retries++;
      } else throw err;
    }
  }
  console.error(`  Added ${remainingIds.length} inboxes (${retries} rejected)`);

  // 4. Upload leads in batches of 100
  let uploaded = 0;
  for (let i = 0; i < leads.length; i += LEADS_BATCH) {
    const batch = leads.slice(i, i + LEADS_BATCH).map((l: any) => ({
      email: l.email,
      first_name: l.first_name || "",
      last_name: l.last_name || "",
      company_name: l.company_name || "",
      custom_fields: {
        Title: l.job_title || "",
        LinkedIn: l.linkedin_url || "",
        Company_Domain: l.company_domain || "",
        Company_Industry: l.company_industry || "",
        [`situation_line_a_${campaignId}`]: l.situation_line_a || "",
        [`value_line_a_${campaignId}`]: l.value_line_a || "",
        [`cta_line_a_${campaignId}`]: l.cta_line_a || "",
        [`situation_line_b_${campaignId}`]: l.situation_line_b || "",
        [`value_line_b_${campaignId}`]: l.value_line_b || "",
        [`cta_line_b_${campaignId}`]: l.cta_line_b || "",
        [`situation_line_c_${campaignId}`]: l.situation_line_c || "",
        [`value_line_c_${campaignId}`]: l.value_line_c || "",
        [`cta_line_c_${campaignId}`]: l.cta_line_c || "",
      },
    }));
    try {
      await slPost(`/campaigns/${campaignId}/leads`, { lead_list: batch });
      uploaded += batch.length;
    } catch (err: any) {
      console.error(`    batch ${Math.floor(i / LEADS_BATCH) + 1}: ${err.message.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`  Uploaded ${uploaded} leads`);

  // 5. Settings + schedule
  await slPost(`/campaigns/${campaignId}/settings`, {
    track_settings: ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"],
    stop_lead_settings: "REPLY_TO_AN_EMAIL",
    send_as_plain_text: false,
    enable_ai_esp_matching: false,
  });
  await slPost(`/campaigns/${campaignId}/schedule`, {
    timezone: "America/New_York",
    days_of_the_week: [1, 2, 3, 4, 5],
    start_hour: "08:00",
    end_hour: "17:00",
    min_time_btw_emails: 8,
    max_new_leads_per_day: 1000,
  });

  // 6. Activate
  if (args.activate) {
    await slPost(`/campaigns/${campaignId}/status`, { status: "START" });
    console.error(`  Campaign #${campaignId} is LIVE`);
  } else {
    console.error(`  Campaign #${campaignId} created in DRAFT`);
  }

  // 7. Save local experiment log
  const result = {
    smartlead_campaign_id: campaignId,
    campaign_name: campaignName,
    domain: args.domain,
    date: today,
    inboxes_assigned: inboxes,
    variants,
    lead_count_uploaded: uploaded,
    launched_at: new Date().toISOString(),
    status: args.activate ? "launched" : "draft",
  };
  if (args.experimentLog) {
    mkdirSync(dirname(args.experimentLog), { recursive: true });
    writeFileSync(args.experimentLog, JSON.stringify(result, null, 2));
    console.error(`  Wrote experiment log to ${args.experimentLog}`);
  }

  console.log(JSON.stringify({ campaignId, inboxCount: inboxes.length, leadsUploaded: uploaded }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
