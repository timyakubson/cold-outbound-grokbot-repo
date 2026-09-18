#!/usr/bin/env tsx
/**
 * Batch-enrich a domain list with full Prospeo company fields (industry,
 * employee_count, revenue, state, city, phone, linkedin, description...).
 * Uses /search-company with company.websites {include:[...]} batched 500 domains
 * per filter (Prospeo max), paginated 25/page. ~free on re-runs within 30 days.
 *
 * Bad rows never fail the run: empty/spaced/dotless/invalid-char domains and
 * subdomains are quarantined to <out>-rejects.csv up front. A batch-level
 * INVALID_FILTERS error removes the named domain (or bisects the batch) and
 * retries, so one poison domain can't 400 the whole batch.
 *
 * Usage: npx tsx enrich-domains.ts --in=domains.csv --out=enriched.csv [--col=domain]
 */
import { parseArgs, readCsv, writeCsv, normDomain, loadEnv, prospeoSearch, prospeoCompanyRow } from "../../list-expander/scripts/lib";

loadEnv();
const args = parseArgs();
if (!args.in || !args.out) {
  console.error("Usage: npx tsx enrich-domains.ts --in=domains.csv --out=enriched.csv [--col=domain]");
  process.exit(1);
}
const col = String(args.col ?? "domain");
const TWO = new Set(["co.uk", "com.au", "com.br", "co.nz"]);
const isSub = (d: string) => { const p = d.split("."); return p.length > 2 && !TWO.has(p.slice(-2).join(".")); };

/** Returns a reject reason if the domain can't go to Prospeo, else null. */
function rejectReason(d: string): string | null {
  if (!d) return "empty";
  if (/\s/.test(d)) return "contains whitespace";
  if (!d.includes(".")) return "no dot";
  if (/[^a-z0-9.-]/.test(d)) return "invalid chars";
  if (isSub(d)) return "subdomain";
  return null;
}

const rejects: { domain: string; reason: string }[] = [];

async function enrichBatch(batch: string[], out: Map<string, Record<string, unknown>>): Promise<void> {
  if (!batch.length) return;
  for (let p = 1; p <= Math.ceil(batch.length / 25) + 2; p++) {
    const r = await prospeoSearch("search-company", { company: { websites: { include: batch } } }, p);
    if (r.error) {
      // Errors past page 1 aren't bad-filter errors (the batch validated on p1) — just stop.
      if (p > 1) { console.error(`  batch p${p}: ${r.error_code} ${r.filter_error ?? ""}`); break; }
      const msg = r.filter_error ?? "";
      const named = batch.find((d) => msg.includes(d));
      if (named) {
        rejects.push({ domain: named, reason: `prospeo ${r.error_code}: ${msg}`.slice(0, 180) });
        await enrichBatch(batch.filter((d) => d !== named), out);
        return;
      }
      if (batch.length === 1) {
        rejects.push({ domain: batch[0], reason: `prospeo ${r.error_code}: ${msg}`.slice(0, 180) });
        return;
      }
      const mid = Math.floor(batch.length / 2);
      await enrichBatch(batch.slice(0, mid), out);
      await enrichBatch(batch.slice(mid), out);
      return;
    }
    if (!r.results.length) break;
    for (const item of r.results) { const row = prospeoCompanyRow(item); out.set(String(row.domain), row); }
  }
}

async function main() {
  const uniq = [...new Set(readCsv(String(args.in)).map((r) => normDomain(r[col])))];
  const domains: string[] = [];
  for (const d of uniq) {
    const reason = rejectReason(d);
    if (reason) rejects.push({ domain: d, reason });
    else domains.push(d);
  }
  console.log(`${uniq.length} unique domains: ${domains.length} to enrich, ${rejects.length} quarantined up front`);

  const out = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < domains.length; i += 500) {
    await enrichBatch(domains.slice(i, i + 500), out);
    console.log(`  batch ${i / 500 + 1}/${Math.ceil(domains.length / 500)}: ${out.size} enriched so far`);
  }

  const rows = domains.map((d) => out.get(d) ?? { domain: d, _not_in_prospeo: true });
  writeCsv(String(args.out), rows as any);

  const rejectsPath = String(args.out).replace(/\.csv$/i, "") + "-rejects.csv";
  writeCsv(rejectsPath, rejects, ["domain", "reason"]);
  console.log(`${out.size} enriched, ${rejects.length} rejects → ${rejectsPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
