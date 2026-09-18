#!/usr/bin/env tsx
/**
 * Fetch replies from a Smartlead campaign for classification.
 *
 * Walks /campaigns/{id}/leads paginated, filters for leads with replies,
 * fetches message history per lead, writes replies to JSON.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/fetch-campaign-replies.ts --campaign-id=12345 --out=/tmp/replies.json
 *
 * Optional flags:
 *   --client-id=<id>      For custom-api-key sub-clients
 *   --since=YYYY-MM-DD    Only replies after this date
 */

import { writeFileSync } from "fs";

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
  const campaignId = get("--campaign-id");
  const out = get("--out") ?? "/tmp/replies.json";
  const clientId = get("--client-id");
  const since = get("--since");
  if (!campaignId) {
    console.error("Usage: --campaign-id=12345 [--out=path] [--client-id=X] [--since=YYYY-MM-DD]");
    process.exit(1);
  }
  return { campaignId, out, clientId, since };
}

interface Lead {
  id: string | number;
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  is_reply?: boolean;
  has_reply?: boolean;
  reply_count?: number;
}

interface Reply {
  lead_id: string | number;
  email: string;
  lead_first_name: string;
  company: string;
  reply_time: string;
  reply_subject: string;
  reply_body: string;
  sequence_step: number;
}

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(url);
    if (resp.status === 429 || resp.status >= 500) {
      const wait = 1000 * 2 ** attempt;
      console.error(`  [${resp.status}] retry in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    return resp.json();
  }
  throw new Error("Exhausted retries");
}

async function listLeadsWithReplies(
  campaignId: string,
  clientId?: string
): Promise<Lead[]> {
  const all: Lead[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const url = new URL(`${API_BASE}/campaigns/${campaignId}/leads`);
    url.searchParams.set("api_key", API_KEY!);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    if (clientId) url.searchParams.set("client_id", clientId);
    const data = await fetchJson(url.toString());
    const batch: Lead[] = data.data ?? data.leads ?? data;
    if (!Array.isArray(batch) || batch.length === 0) break;
    const withReplies = batch.filter(
      (l) => l.is_reply === true || l.has_reply === true || (l.reply_count ?? 0) > 0
    );
    all.push(...withReplies);
    console.error(`  offset=${offset} batch=${batch.length} withReplies=${withReplies.length} total=${all.length}`);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function fetchMessageHistory(
  campaignId: string,
  leadId: string | number
): Promise<any[]> {
  const url = new URL(`${API_BASE}/campaigns/${campaignId}/leads/${leadId}/message-history`);
  url.searchParams.set("api_key", API_KEY!);
  const data = await fetchJson(url.toString());
  return data.history ?? data.data ?? data ?? [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const { campaignId, out, clientId, since } = parseArgs();
  console.error(`Fetching leads with replies for campaign ${campaignId}...`);
  const leads = await listLeadsWithReplies(campaignId, clientId);
  console.error(`Found ${leads.length} leads with replies. Fetching message histories...`);

  const replies: Reply[] = [];
  const sinceDate = since ? new Date(since) : null;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      const history = await fetchMessageHistory(campaignId, lead.id);
      // Find first inbound reply (type === 'REPLY' or message_type === 'inbound')
      const firstReply = history.find(
        (m: any) =>
          m.type === "REPLY" ||
          m.message_type === "REPLY" ||
          m.message_type === "inbound" ||
          m.direction === "inbound"
      );
      if (!firstReply) {
        console.error(`  lead ${lead.id} had reply flag but no reply in history`);
        continue;
      }
      const replyTime = firstReply.time || firstReply.sent_time || firstReply.received_time;
      if (sinceDate && replyTime && new Date(replyTime) < sinceDate) continue;
      const rawBody = firstReply.email_body || firstReply.body || firstReply.body_text || "";
      replies.push({
        lead_id: lead.id,
        email: lead.email,
        lead_first_name: lead.first_name || "",
        company: lead.company_name || "",
        reply_time: replyTime || "",
        reply_subject: firstReply.subject || "",
        reply_body: stripHtml(rawBody).slice(0, 5000),
        sequence_step: firstReply.stats_id || firstReply.seq_number || 0,
      });
      if ((i + 1) % 20 === 0) {
        console.error(`  ${i + 1}/${leads.length} fetched`);
      }
    } catch (err) {
      console.error(`  lead ${lead.id} failed: ${String(err).slice(0, 100)}`);
    }
  }

  writeFileSync(out, JSON.stringify(replies, null, 2));
  console.error(`\nWrote ${out} — ${replies.length} replies`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
