#!/usr/bin/env tsx
/**
 * contacts.ts — Phase 4+5 driver (WS8): qualified companies → send-ready leads.
 *
 *     npx tsx contacts.ts --config=<lane.json>            (after lane is READY)
 *
 * Waterfall (hard rules — ALL matching titles, NEVER capped, provider emails
 * never trusted):
 *   1. GetLeads export (free) — 500-domain batches, ALL seniorities/titles.
 *   2. Blitz find-contacts for domains GetLeads left at zero coverage.
 *   3. Prospeo /search-person LAST for still-zero domains (paid).
 *   4. contacts-merge → leads-final.csv (contacts with a provider email;
 *      validate with MillionVerifier before sending — see SKILL.md "Emails").
 *
 * Stages (contacts-state.json, same artifact-based resume as run-lane):
 *   GETLEADS → COVERAGE → BLITZ → PROSPEO_PEOPLE → MERGE → EMAILS → REPORT
 * Gate: refuses to run unless the lane's summary.md first line is READY
 * (override: --force after human review).
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { loadEnv, parseArgs, readCsv, writeCsv, normDomain, prospeoSearch, saveMetrics } from "../../list-expander/scripts/lib";
import { getleadsExportToCsv, hasGetleadsKey } from "./getleads-client";

loadEnv();
process.on("unhandledRejection", (e) => console.error("unhandled:", String(e).slice(0, 120)));
const args = parseArgs();
const LB = resolve(fileURLToPath(import.meta.url), "..");
if (!args.config || !existsSync(String(args.config))) {
  console.error("Usage: npx tsx contacts.ts --config=<lane.json> [--force] [--run-dir=<dir>]\n" +
    "  Runs Phase 4+5 for a READY lane: GetLeads -> Blitz -> Prospeo -> merge -> leads-final.csv (validate with MillionVerifier).");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(String(args.config), "utf8"));
const laneId = `${cfg.client_slug}-${cfg.name}`;
const runDir = String(args["run-dir"] ?? join(homedir(), "output", "list-builder", "lanes", laneId));
const SENIORITIES: string[] = String(cfg.seniorities ?? "Founder/Owner,C-Suite,Partner,Vice President,Head,Director").split(",");
// GetLeads live seniority enum (API changed, discovered 2026-08-05 by a deep-contacts
// benchmark; re-verified live 2026-08-07): C-Team, VP, Director, Manager, Staff, Other.
// The OLD values Founder / C-Level / Head / Partner now HARD-ERROR the whole call
// ("Invalid seniority value(s)"), which previously left lanes with ZERO GetLeads contacts.
const GETLEADS_VALID_SENIORITIES = new Set(["C-Team", "VP", "Director", "Manager", "Staff", "Other"]);
const GETLEADS_SENIORITY_MAP: Record<string, string> = {
  "Founder/Owner": "C-Team", "Founder": "C-Team", "Owner": "C-Team",
  "C-Suite": "C-Team", "C-Level": "C-Team",
  "Partner": "C-Team",
  "Vice President": "VP", "VP": "VP",
  "Head": "Director", "Director": "Director",
  "Manager": "Manager", "Staff": "Staff", "Other": "Other",
};
function getleadsSeniorities(): string[] {
  const mapped = [...new Set(SENIORITIES.map((s: string) => GETLEADS_SENIORITY_MAP[s.trim()] ?? s.trim()))];
  const valid = mapped.filter((v) => GETLEADS_VALID_SENIORITIES.has(v));
  const dropped = mapped.filter((v) => !GETLEADS_VALID_SENIORITIES.has(v));
  if (dropped.length) console.error(`!! GETLEADS: dropping unmappable seniority value(s) [${dropped.join(", ")}] — live enum is [${[...GETLEADS_VALID_SENIORITIES].join(", ")}]; sending an invalid value hard-errors the entire batch. Extend GETLEADS_SENIORITY_MAP if these matter.`);
  if (!valid.length) throw new Error(`GETLEADS FATAL: no valid seniority values after mapping lane seniorities [${SENIORITIES.join(",")}] — fix GETLEADS_SENIORITY_MAP in contacts.ts`);
  return valid;
}

const statePath = join(runDir, "contacts-state.json");
const state: Record<string, { status: string; note?: string }> = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
function save(): void { const t = statePath + ".tmp"; writeFileSync(t, JSON.stringify(state, null, 2)); renameSync(t, statePath); }
function done(stage: string): boolean { return state[stage]?.status === "done"; }
function mark(stage: string, note?: string): void { state[stage] = { status: "done", note }; save(); console.log(`✓ ${stage}${note ? ` — ${note}` : ""}`); }

const A = {
  final: join(runDir, "lane-final.csv"),
  summary: join(runDir, "summary.md"),
  getleads: join(runDir, "contacts-getleads.csv"),
  blitz: join(runDir, "contacts-blitz.csv"),
  prospeoPeople: join(runDir, "contacts-prospeo.csv"),
  merged: join(runDir, "contacts-merged.csv"),
  leadsFinal: join(runDir, "leads-final.csv"),
  coverage: join(runDir, "contacts-coverage.json"),
};

function tsx(script: string, argv: string[]): number {
  return spawnSync("npx", ["tsx", script, ...argv], { stdio: "inherit", timeout: 6 * 3600_000 }).status ?? 1;
}

async function main() {
  // READY gate
  if (!existsSync(A.summary) || !readFileSync(A.summary, "utf8").startsWith("# READY")) {
    if (!args.force) { console.error(`REFUSING: ${A.summary} is not READY. Finish run-lane first, or --force after human review.`); process.exit(2); }
  }
  const domains = [...new Set(readCsv(A.final).map((r) => normDomain(r.domain)).filter(Boolean))];
  const nameByDomain = new Map(readCsv(A.final).map((r) => [normDomain(r.domain), r.name]));
  console.log(`contacts for ${laneId}: ${domains.length} companies — NO CAPS, all matching titles`);

  // 1. GETLEADS
  // NOTE (provider result caps, 2026-07-14): unlike Prospeo /search-company (hard
  // ~24k/filter tail truncation — auto-sharded in pull.ts), GetLeads export has no
  // observed per-query result cap here (we batch domains 500/call and paginate the
  // export to completion), so no sharding is needed. If a future GetLeads response
  // ever caps total rows, shard the domain batch the same way pull.ts shards states.
  if (!done("GETLEADS") && !hasGetleadsKey()) {
    // OPTIONAL provider: no key ⇒ every domain falls through to Blitz/Prospeo below.
    writeCsv(A.getleads, []);
    mark("GETLEADS", "skipped: GETLEADS_API_KEY not set — Blitz/Prospeo will cover every domain");
  }
  if (!done("GETLEADS")) {
    let total = 0;
    let failedBatches = 0;
    const glSeniority = getleadsSeniorities();
    const parts: string[] = [];
    for (let i = 0; i < domains.length; i += 500) {
      const batch = domains.slice(i, i + 500);
      const part = join(runDir, `gl-part-${i}.csv`);
      try {
        const n = await getleadsExportToCsv({ domains: batch, seniority: glSeniority }, part);
        total += n; parts.push(part);
        console.log(`  getleads batch ${i / 500 + 1}: ${n} contacts`);
      } catch (e) {
        const msg = String(e);
        // Enum/validation rejections are FATAL for the stage: every batch would fail the
        // same way, and swallowing this exact error class is what silently produced
        // zero-GetLeads lanes when the seniority enum changed (2026-08). Never continue.
        if (/invalid seniority|"field"\s*:\s*"seniority"|invalid.*value\(s\)/i.test(msg)) {
          throw new Error(`GETLEADS FATAL (enum rejected by API): ${msg.slice(0, 300)}\nThe live seniority enum has changed again — update GETLEADS_VALID_SENIORITIES + GETLEADS_SENIORITY_MAP in contacts.ts. Refusing to continue: proceeding here would mark the stage done with ZERO GetLeads contacts.`);
        }
        failedBatches++;
        console.error(`!! GETLEADS batch ${i / 500 + 1} FAILED: ${msg.slice(0, 200)}`);
      }
    }
    if (failedBatches && parts.length === 0) {
      throw new Error(`GETLEADS FATAL: all ${failedBatches} batch(es) failed — refusing to mark the primary contact stage done with zero GetLeads contacts. Fix the error above and re-run (stage resumes).`);
    }
    // concat parts
    const rows = parts.flatMap((p) => (existsSync(p) ? readCsv(p) : []));
    writeCsv(A.getleads, rows);
    mark("GETLEADS", `${rows.length} contacts${failedBatches ? ` — WARNING: ${failedBatches} batch(es) FAILED, GetLeads coverage incomplete (Blitz/Prospeo will over-cover those domains)` : ""}`);
  }

  // 2. COVERAGE
  const glRows = existsSync(A.getleads) ? readCsv(A.getleads) : [];
  const covered = new Map<string, number>();
  for (const r of glRows) { const d = normDomain(r["Company Domain"] || r.domain || ""); if (d) covered.set(d, (covered.get(d) ?? 0) + 1); }
  const zero = domains.filter((d) => !covered.get(d));
  writeFileSync(A.coverage, JSON.stringify({ companies: domains.length, covered: domains.length - zero.length, zero_coverage: zero.length, zero_domains: zero }, null, 2));
  if (!done("COVERAGE")) mark("COVERAGE", `${domains.length - zero.length}/${domains.length} covered by GetLeads; ${zero.length} need fallback`);

  // 3. BLITZ (free on Unlimited) for zero-coverage domains
  // TODO (provider cap): Blitz Employee Finder caps at max-pages × max-results per
  // company (default 1×25 = 25 people/domain). This is a PER-COMPANY cap, not a
  // filter-result cap, so it never truncates the domain set — but it can under-pull
  // people at large companies. Raise --max-pages in find-contacts.ts for lanes that
  // target big employers if a domain returns exactly 25 (the page-1 ceiling).
  if (!done("BLITZ")) {
    // sibling skill in this repo (skills/blitz-list-builder), else an installed copy
    const blitzScript = [
      join(LB, "..", "..", "blitz-list-builder", "scripts", "find-contacts.ts"),
      join(homedir(), ".claude", "skills", "blitz-list-builder", "scripts", "find-contacts.ts"),
    ].find(existsSync) ?? "";
    if (zero.length && blitzScript) {
      const zin = join(runDir, "blitz-in.csv");
      writeCsv(zin, zero.map((d) => ({ domain: d, company_name: nameByDomain.get(d) ?? d })));
      // find-contacts.ts interface: --domains-file (NOT --in); wrong flag = usage-print + exit 1 (2026-07-08)
      const code = tsx(blitzScript, [`--domains-file=${zin}`, `--out=${A.blitz}`, `--titles=${cfg.blitz_titles ?? "owner,co-owner,founder,co-founder,ceo,president,general manager,managing member,managing partner,principal,proprietor"}`, "--concurrency=25"]);
      mark("BLITZ", code === 0 ? `${existsSync(A.blitz) ? readCsv(A.blitz).length : 0} contacts` : "blitz failed — Prospeo will cover");
    } else mark("BLITZ", zero.length ? "skipped: blitz-list-builder/scripts/find-contacts.ts not found (or BLITZ_API_KEY unset) — Prospeo will cover" : "not needed");
  }

  // 4. PROSPEO people for STILL-zero domains
  if (!done("PROSPEO_PEOPLE")) {
    for (const r of existsSync(A.blitz) ? readCsv(A.blitz) : []) { const d = normDomain(r.domain || r["Company Domain"] || ""); if (d) covered.set(d, (covered.get(d) ?? 0) + 1); }
    const still = domains.filter((d) => !covered.get(d));
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < still.length; i += 400) {
      const batch = still.slice(i, i + 400).filter((d) => d.split(".").length <= 2);
      if (!batch.length) continue;
      for (let page = 1; page <= 40; page++) {
        const r = await prospeoSearch("search-person", { company: { websites: { include: batch } }, person_seniority: { include: SENIORITIES.map((s: string) => s.trim()) } }, page);
        if (r.error || !r.results.length) break;
        for (const item of r.results) {
          const p = item.person ?? item;
          const c = item.company ?? {};
          out.push({ first_name: p.first_name, last_name: p.last_name, job_title: p.job_title ?? p.title, linkedin_url: p.linkedin_url, domain: normDomain(c.domain ?? c.website ?? ""), company_name: c.name ?? "" });
        }
        if ((r.total_count ?? 0) <= page * 25) break;
      }
    }
    writeCsv(A.prospeoPeople, out);
    mark("PROSPEO_PEOPLE", `${out.length} contacts for ${still.length} uncovered domains`);
  }

  // 5. MERGE
  if (!done("MERGE")) {
    // lane-scoped merge dir — a shared "__contacts__" slug let a second lane's run
    // overwrite the first lane's merged contacts (bit us 2026-07-08)
    const mergeSlug = `__contacts__${laneId}`;
    const argv = [`--run=${mergeSlug}`, `--csv=${A.getleads}:getleads`];
    if (existsSync(A.blitz) && readCsv(A.blitz).length) argv.push(`--csv=${A.blitz}:blitz`);
    if (existsSync(A.prospeoPeople) && readCsv(A.prospeoPeople).length) argv.push(`--csv=${A.prospeoPeople}:prospeo`);
    const code = tsx(join(LB, "contacts-merge.ts"), argv);
    if (code !== 0) throw new Error("contacts-merge failed");
    const src = join(homedir(), "output", "list-builder", mergeSlug, "contacts-merged.csv");
    writeFileSync(A.merged, readFileSync(src));
    mark("MERGE", `${readCsv(A.merged).length} unique contacts`);
  }

  // 6. EMAILS — keep every merged contact that has a provider email.
  // GetLeads / Blitz / Prospeo all return an email + status per person. Rows whose
  // provider says "verified"/"valid" are flagged email_status=verified; everything
  // else is "unverified". Validate the whole file with MillionVerifier before you
  // upload (see SKILL.md "Emails") — never send to unverified/catch-all addresses.
  if (!done("EMAILS")) {
    const rows = readCsv(A.merged);
    const okStatus = /^(verified|valid|deliverable|ok|safe)$/i;
    const leads = rows.filter((r) => (r.provider_email || "").includes("@")).map((r) => ({
      ...r,
      email: r.provider_email,
      email_status: okStatus.test(r.provider_email_status || "") ? "verified" : "unverified",
    }));
    writeCsv(A.leadsFinal, leads);
    const nv = leads.filter((l) => l.email_status === "verified").length;
    mark("EMAILS", `${leads.length} contacts with an email (${nv} provider-verified) — validate with MillionVerifier before sending`);
  }

  // 7. REPORT
  saveMetrics(runDir, { contacts_stage: true });
  const leads = existsSync(A.leadsFinal) ? readCsv(A.leadsFinal).length : 0;
  const merged = existsSync(A.merged) ? readCsv(A.merged).length : 0;
  console.log(`\n# CONTACTS DONE — ${laneId}\n- companies: ${domains.length}\n- unique contacts: ${merged}\n- contacts with an email: ${leads} (see email_status column; run MillionVerifier before upload)\n- artifacts: ${A.leadsFinal}\nNext: upload to campaign platform per client instructions (leads-final.csv).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
