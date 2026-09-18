#!/usr/bin/env tsx
/**
 * Phase 4: Email waterfall + description enrichment + MV validation.
 *
 * - For leads missing email: hit Prospeo enrich-person
 * - For leads with thin company_description: scrape their company domain
 * - Validate all candidate emails with MillionVerifier (only "ok" emails kept)
 *
 * Usage:
 *   export PROSPEO_API_KEY=xxx
 *   export MILLIONVERIFIER_API_KEY=xxx
 *   npx tsx scripts/phase-enrich.ts --leads-file=/tmp/auto/leads.json --out=/tmp/auto/enriched.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const PROSPEO_KEY = process.env.PROSPEO_API_KEY;
const MV_KEY = process.env.MILLIONVERIFIER_API_KEY;
if (!PROSPEO_KEY) {
  console.error("Missing env: PROSPEO_API_KEY");
  process.exit(1);
}
if (!MV_KEY) {
  console.error("Warning: MILLIONVERIFIER_API_KEY not set — skipping validation");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    leadsFile: get("--leads-file"),
    out: get("--out") ?? "/tmp/auto/enriched.json",
    enrichConcurrency: Number(get("--concurrency") ?? 5),
  };
}

async function enrichEmail(lead: any): Promise<string> {
  if (!lead.first_name || !lead.last_name || !lead.company_domain) return "";
  const resp = await fetch("https://api.prospeo.io/email-finder", {
    method: "POST",
    headers: { "X-KEY": PROSPEO_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: lead.first_name,
      last_name: lead.last_name,
      company: lead.company_domain,
    }),
  });
  if (!resp.ok) return "";
  const data = await resp.json();
  const email = data.response?.email || data.email || "";
  if (typeof email === "string" && email.includes("@")) return email;
  return "";
}

async function scrapeDescription(domain: string): Promise<string> {
  if (!domain) return "";
  try {
    const resp = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    if (meta && meta[1].length > 30) return meta[1].trim().slice(0, 500);
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (og && og[1].length > 30) return og[1].trim().slice(0, 500);
    return "";
  } catch {
    return "";
  }
}

async function verifyEmail(email: string): Promise<"ok" | "invalid" | "skip"> {
  if (!MV_KEY) return "skip";
  try {
    const resp = await fetch(
      `https://api.millionverifier.com/api/v3/?api=${MV_KEY}&email=${encodeURIComponent(email)}&timeout=10`
    );
    if (!resp.ok) return "skip";
    const data = await resp.json();
    const result = data.resultcode ?? data.result;
    return result === 1 || result === "ok" ? "ok" : "invalid";
  } catch {
    return "skip";
  }
}

async function pool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch (e) {
        out[idx] = null as any;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const { leadsFile, out, enrichConcurrency } = parseArgs();
  if (!leadsFile) {
    console.error("Usage: --leads-file=path [--out=path]");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(leadsFile, "utf8"));
  const leads: any[] = data.leads || data;

  let alreadyHad = 0,
    enrichHits = 0,
    enrichMisses = 0;

  // 1. Email waterfall — only enrich leads without email
  console.error(`[Enrich] Running email waterfall on ${leads.length} leads...`);
  const needEmail = leads.filter((l) => !l.email || !l.email.includes("@"));
  alreadyHad = leads.length - needEmail.length;
  const enrichResults = await pool(needEmail, enrichConcurrency, (l) => enrichEmail(l));
  needEmail.forEach((l, i) => {
    if (enrichResults[i]) {
      l.email = enrichResults[i];
      enrichHits++;
    } else {
      enrichMisses++;
    }
  });
  console.error(`[Enrich] Already had: ${alreadyHad}, Prospeo enrich hits: ${enrichHits}, misses: ${enrichMisses}`);

  // 2. Description enrichment for leads with thin desc
  console.error(`[Enrich] Enriching thin company descriptions...`);
  const needDesc = leads.filter(
    (l) => (!l.company_description || l.company_description.length < 50) && l.company_domain
  );
  const descResults = await pool(needDesc, enrichConcurrency, (l) => scrapeDescription(l.company_domain));
  let descHits = 0;
  needDesc.forEach((l, i) => {
    if (descResults[i]) {
      l.company_description = descResults[i];
      descHits++;
    }
  });
  console.error(`[Enrich] Description scrapes: ${descHits} / ${needDesc.length}`);

  // 3. Validate emails via MillionVerifier
  const withEmail = leads.filter((l) => l.email && l.email.includes("@"));
  let mvOk = 0,
    mvInvalid = 0,
    mvSkip = 0;
  if (MV_KEY) {
    console.error(`[Enrich] Validating ${withEmail.length} emails with MillionVerifier...`);
    const mvResults = await pool(withEmail, enrichConcurrency, (l) => verifyEmail(l.email));
    withEmail.forEach((l, i) => {
      const result = mvResults[i];
      if (result === "ok") mvOk++;
      else if (result === "invalid") {
        mvInvalid++;
        l.email = ""; // clear invalid emails
      } else mvSkip++;
    });
    console.error(`[Enrich] MV: ${mvOk} ok, ${mvInvalid} invalid, ${mvSkip} skip`);
  }

  const finalWithEmail = leads.filter((l) => l.email && l.email.includes("@"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        leads: finalWithEmail,
        allLeads: leads,
        stats: {
          total: leads.length,
          already_had_email: alreadyHad,
          enrich_hits: enrichHits,
          enrich_misses: enrichMisses,
          description_hits: descHits,
          mv_ok: mvOk,
          mv_invalid: mvInvalid,
          final_with_email: finalWithEmail.length,
        },
      },
      null,
      2
    )
  );
  console.error(`\nWrote ${out} — ${finalWithEmail.length} leads with valid email`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
