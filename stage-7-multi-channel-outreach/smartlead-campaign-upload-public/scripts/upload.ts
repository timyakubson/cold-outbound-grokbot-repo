#!/usr/bin/env tsx
/**
 * Upload a variants.yaml + leads.csv to Smartlead as a DRAFT campaign.
 *
 * ALWAYS creates in DRAFT. No --activate flag. Review in Smartlead UI and press Start manually.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/upload.ts \
 *     --leads=path/to/leads.csv \
 *     --variants=path/to/variants.yaml
 *
 * Optional:
 *   --client-id=X    Smartlead sub-client ID (if your account uses sub-clients)
 */

import { readFileSync } from "fs";

const API = "https://server.smartlead.ai/api/v1";
const API_KEY = process.env.SMARTLEAD_API_KEY;
if (!API_KEY) {
  console.error("Missing env: SMARTLEAD_API_KEY");
  process.exit(1);
}

const LEADS_BATCH = 100;

// Allowed CSV columns — see references/leads-csv-schema.md. Changing this requires a skill update.
const REQUIRED_COLS = ["email", "first_name", "last_name", "company_name"];
const ALLOWED_COLS = new Set([
  ...REQUIRED_COLS,
  "company_domain",
  "title",
  "linkedin_url",
  "situation_line",
  "value_line",
  "cta_line",
]);

// ---------- arg parsing ----------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    leads: get("--leads"),
    variants: get("--variants"),
    clientId: get("--client-id"),
  };
}

// ---------- CSV parsing ----------

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cols = parseCsvLine(l);
    const r: Record<string, string> = {};
    headers.forEach((h, i) => (r[h] = (cols[i] ?? "").trim()));
    return r;
  });
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ---------- minimal YAML parser ----------
// Supports the subset we need: nested maps, lists of maps, scalars (strings/numbers/bools), array literals [1,2,3].
// Does NOT support: anchors, tags, multi-line folded/literal strings (|, >), flow-style maps {}.
// Quoted strings ("...") are supported for values with special chars.

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

function parseYaml(text: string): YamlValue {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  // Strip comments (but not inside quoted strings — simple heuristic)
  const cleaned: { indent: number; content: string }[] = [];
  for (const raw of lines) {
    let line = raw;
    // strip trailing comment if not inside quotes
    let inQuote: string | null = null;
    let commentAt = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === inQuote && line[i - 1] !== "\\") inQuote = null;
      } else {
        if (c === '"' || c === "'") inQuote = c;
        else if (c === "#") { commentAt = i; break; }
      }
    }
    if (commentAt >= 0) line = line.slice(0, commentAt);
    const trimmedRight = line.replace(/\s+$/, "");
    if (!trimmedRight.trim()) continue;
    const indent = trimmedRight.search(/\S/);
    cleaned.push({ indent, content: trimmedRight.slice(indent) });
  }

  let idx = 0;
  function parseBlock(parentIndent: number): YamlValue {
    if (idx >= cleaned.length) return null;
    const firstIndent = cleaned[idx].indent;
    if (firstIndent <= parentIndent) return null;
    // detect list vs map
    if (cleaned[idx].content.startsWith("- ")) return parseList(firstIndent);
    return parseMap(firstIndent);
  }

  function parseMap(indent: number): Record<string, YamlValue> {
    const obj: Record<string, YamlValue> = {};
    while (idx < cleaned.length) {
      const line = cleaned[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new Error(`Unexpected indent on line: ${line.content}`);
      }
      const content = line.content;
      const colonIdx = findColon(content);
      if (colonIdx === -1) {
        throw new Error(`Expected key: value, got: ${content}`);
      }
      const key = content.slice(0, colonIdx).trim();
      const afterColon = content.slice(colonIdx + 1).trim();
      idx++;
      if (afterColon === "") {
        // nested block
        obj[key] = parseBlock(indent);
      } else {
        obj[key] = parseScalar(afterColon);
      }
    }
    return obj;
  }

  function parseList(indent: number): YamlValue[] {
    const arr: YamlValue[] = [];
    while (idx < cleaned.length) {
      const line = cleaned[idx];
      if (line.indent < indent) break;
      if (line.indent > indent || !line.content.startsWith("- ")) break;
      const afterDash = line.content.slice(2);
      idx++;
      if (afterDash.trim() === "") {
        // "- " alone → nested block follows
        arr.push(parseBlock(indent));
        continue;
      }
      // Check if it's a key: value on the same line as -
      const colonIdx = findColon(afterDash);
      if (colonIdx !== -1 && !afterDash.trim().startsWith('"') && !afterDash.trim().startsWith("'")) {
        // inline map starting with `- key: value`
        // Treat this line's key:value as the first entry in a map, then keep parsing subsequent lines at indent+2.
        const key = afterDash.slice(0, colonIdx).trim();
        const afterKey = afterDash.slice(colonIdx + 1).trim();
        const obj: Record<string, YamlValue> = {};
        if (afterKey === "") {
          obj[key] = parseBlock(indent + 2);
        } else {
          obj[key] = parseScalar(afterKey);
        }
        // continue parsing more map keys at indent + 2
        while (idx < cleaned.length) {
          const nl = cleaned[idx];
          if (nl.indent <= indent) break;
          if (nl.content.startsWith("- ")) break;
          const ci = findColon(nl.content);
          if (ci === -1) break;
          const k2 = nl.content.slice(0, ci).trim();
          const v2 = nl.content.slice(ci + 1).trim();
          idx++;
          if (v2 === "") obj[k2] = parseBlock(nl.indent);
          else obj[k2] = parseScalar(v2);
        }
        arr.push(obj);
      } else {
        arr.push(parseScalar(afterDash));
      }
    }
    return arr;
  }

  return parseBlock(-1);
}

function findColon(s: string): number {
  let inQuote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote && s[i - 1] !== "\\") inQuote = null;
    } else {
      if (c === '"' || c === "'") inQuote = c;
      else if (c === ":") return i;
    }
  }
  return -1;
}

function parseScalar(s: string): YamlValue {
  const t = s.trim();
  if (!t) return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => parseScalar(x.trim()));
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
  return t;
}

// ---------- Smartlead API helpers ----------

async function slPost(path: string, body: any): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(`${API}${path}?api_key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`POST ${path} → ${resp.status}: ${t.slice(0, 300)}`);
    }
    return resp.json();
  }
  throw new Error(`Exhausted retries for POST ${path}`);
}

async function slGet(path: string): Promise<any> {
  const resp = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}api_key=${API_KEY}`);
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`GET ${path} → ${resp.status}: ${t.slice(0, 200)}`);
  }
  return resp.json();
}

async function listInboxes(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const batch = await slGet(`/email-accounts?offset=${offset}&limit=100`);
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

// ---------- validation ----------

function validateVariants(v: any): void {
  if (!v || typeof v !== "object") throw new Error("variants.yaml must be a map at the top level");
  if (!v.name) throw new Error("variants.yaml: `name` is required");
  if (!v.schedule) throw new Error("variants.yaml: `schedule` is required");
  if (!v.inbox_selection?.tag) throw new Error("variants.yaml: `inbox_selection.tag` is required");
  if (!Number.isFinite(v.inbox_selection?.count)) throw new Error("variants.yaml: `inbox_selection.count` must be a number");
  if (!Array.isArray(v.sequences) || !v.sequences.length) throw new Error("variants.yaml: `sequences` must be a non-empty array");
  for (const seq of v.sequences) {
    if (!Number.isFinite(seq.step)) throw new Error("sequences[].step must be a number");
    if (!Number.isFinite(seq.delay_days)) throw new Error("sequences[].delay_days must be a number");
    if (!Array.isArray(seq.variants) || !seq.variants.length) throw new Error("sequences[].variants must be a non-empty array");
    for (const variant of seq.variants) {
      if (!variant.label) throw new Error("sequences[].variants[].label required");
      if (typeof variant.subject !== "string") throw new Error("sequences[].variants[].subject must be a string (empty string OK for threaded follow-ups)");
      if (typeof variant.body !== "string" || !variant.body) throw new Error("sequences[].variants[].body is required and non-empty");
    }
  }
}

function validateCsvSchema(headers: string[]): void {
  const missing = REQUIRED_COLS.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`leads.csv missing required columns: ${missing.join(", ")}`);
  const extras = headers.filter((h) => !ALLOWED_COLS.has(h));
  if (extras.length) {
    throw new Error(
      `leads.csv has unallowed columns: ${extras.join(", ")}.\n` +
      `To add a new column, update references/leads-csv-schema.md and the ALLOWED_COLS set in this script.`
    );
  }
}

// ---------- main ----------

async function main() {
  const args = parseArgs();
  if (!args.leads || !args.variants) {
    console.error("Usage: --leads=<path> --variants=<path> [--client-id=X]");
    process.exit(1);
  }

  // 1. Load + validate leads
  console.error(`Loading leads from ${args.leads}...`);
  const csvText = readFileSync(args.leads, "utf8");
  const { headers, rows: leads } = parseCsv(csvText);
  validateCsvSchema(headers);
  console.error(`  ${leads.length} leads, columns: ${headers.join(", ")}`);

  // 2. Load + validate variants
  console.error(`Loading variants from ${args.variants}...`);
  const variantsYaml = readFileSync(args.variants, "utf8");
  const v = parseYaml(variantsYaml) as any;
  validateVariants(v);
  const variantCount = v.sequences.reduce((s: number, seq: any) => s + seq.variants.length, 0);
  console.error(`  ${v.sequences.length} sequences, ${variantCount} total variants`);

  // 3. Create campaign
  console.error(`Creating Smartlead campaign "${v.name}"...`);
  const createBody: any = { name: v.name };
  if (args.clientId) createBody.client_id = Number(args.clientId);
  const created = await slPost("/campaigns/create", createBody);
  const campaignId = created.id ?? created.campaign_id;
  if (!campaignId) throw new Error(`Campaign create failed: ${JSON.stringify(created)}`);
  console.error(`  ✓ Campaign #${campaignId}`);

  // 4. Save sequences
  const slSequences = v.sequences.map((seq: any) => ({
    seq_number: seq.step,
    seq_delay_details: { delay_in_days: seq.delay_days },
    seq_variants: seq.variants.map((va: any) => ({
      variant_label: va.label,
      subject: (va.subject || "").replace(/—/g, " - ").replace(/–/g, " - "),
      email_body: va.body,
    })),
  }));
  await slPost(`/campaigns/${campaignId}/sequences`, { sequences: slSequences });
  console.error(`  ✓ Sequence saved (${v.sequences.length} steps)`);

  // 5. Select inboxes by tag, LRU by daily_sent_count
  const allInboxes = await listInboxes();
  const tagged = allInboxes.filter((inb: any) =>
    (inb.tags ?? []).some((t: any) => t.name === v.inbox_selection.tag) &&
    inb.is_smtp_success &&
    !inb.warmup_details?.is_warmup_blocked
  );
  tagged.sort((a: any, b: any) => (a.daily_sent_count ?? 0) - (b.daily_sent_count ?? 0));
  const selected = tagged.slice(0, v.inbox_selection.count);
  if (!selected.length) {
    throw new Error(`No healthy inboxes found with tag=${v.inbox_selection.tag}. Run /smartlead-inbox-manager to tag inboxes first.`);
  }
  if (selected.length < v.inbox_selection.count) {
    console.error(`  ⚠ Only ${selected.length} inboxes matched (requested ${v.inbox_selection.count}). Proceeding with what's available.`);
  }
  let attachIds = selected.map((i: any) => i.id);
  let retries = 0;
  while (attachIds.length && retries < 10) {
    try {
      await slPost(`/campaigns/${campaignId}/email-accounts`, { email_account_ids: attachIds });
      break;
    } catch (err: any) {
      const m = err.message?.match(/Email account id - (\d+) not allowed/);
      if (m) {
        const bad = Number(m[1]);
        attachIds = attachIds.filter((id: number) => id !== bad);
        retries++;
      } else throw err;
    }
  }
  console.error(`  ✓ ${attachIds.length} inboxes attached (tag=${v.inbox_selection.tag}, LRU)`);

  // 6. Upload leads in batches
  let uploaded = 0;
  for (let i = 0; i < leads.length; i += LEADS_BATCH) {
    const batch = leads.slice(i, i + LEADS_BATCH).map((l) => {
      const custom_fields: Record<string, string> = {};
      for (const h of headers) {
        if (!REQUIRED_COLS.includes(h) && l[h]) custom_fields[h] = l[h];
      }
      return {
        email: l.email,
        first_name: l.first_name || "",
        last_name: l.last_name || "",
        company_name: l.company_name || "",
        custom_fields,
      };
    });
    try {
      await slPost(`/campaigns/${campaignId}/leads`, { lead_list: batch });
      uploaded += batch.length;
      process.stdout.write(`  ${uploaded}/${leads.length} leads uploaded\r`);
    } catch (err: any) {
      console.error(`\n  ⚠ batch ${i}-${i + LEADS_BATCH} failed: ${err.message?.slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  console.error(`\n  ✓ ${uploaded} leads uploaded`);

  // 7. Settings (track off, stop on reply)
  await slPost(`/campaigns/${campaignId}/settings`, {
    track_settings: ["DONT_TRACK_EMAIL_OPEN", "DONT_TRACK_LINK_CLICK"],
    stop_lead_settings: "REPLY_TO_AN_EMAIL",
    send_as_plain_text: false,
    enable_ai_esp_matching: false,
  });
  console.error(`  ✓ Settings saved (tracking off, stop on reply)`);

  // 8. Schedule
  await slPost(`/campaigns/${campaignId}/schedule`, {
    timezone: v.schedule.timezone,
    days_of_the_week: v.schedule.days,
    start_hour: v.schedule.start_hour,
    end_hour: v.schedule.end_hour,
    min_time_btw_emails: v.schedule.min_time_btw_emails,
    max_new_leads_per_day: v.schedule.max_leads_per_day,
  });
  console.error(`  ✓ Schedule set (${v.schedule.timezone}, ${v.schedule.start_hour}-${v.schedule.end_hour})`);

  // 9. DRAFT only. Do not activate.
  console.log(``);
  console.log(`✓ Campaign #${campaignId} created in DRAFT`);
  console.log(``);
  console.log(`Review + Start:`);
  console.log(`  → https://app.smartlead.ai/app/email-campaign/${campaignId}`);
  console.log(``);
  console.log(`This script does NOT auto-activate. Review the campaign in Smartlead UI and hit Start when satisfied.`);
}

main().catch((e) => {
  console.error("\nERROR:", e.message);
  process.exit(1);
});
