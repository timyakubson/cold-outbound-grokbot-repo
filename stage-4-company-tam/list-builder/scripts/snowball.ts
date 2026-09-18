#!/usr/bin/env tsx
/**
 * snowball.ts — automated sweep-until-dry (WS3). Run AFTER a lane's first
 * run-lane pass is READY:
 *
 *     npx tsx snowball.ts --config=<lane.json>
 *
 * Each round:
 *   1. Confirmed set = verified domains (lane WAL + verified.stream).
 *   2. Derive candidate INDUSTRIES carried by ≥1 confirmed fit (from pull/enrich
 *      data) — the exhaustive-sweep law — plus lookalikes from the newest
 *      confirmed seeds.
 *   3. Diff against the swept-filter ledger (normalized string + sha; paid
 *      repeats blocked, free <30d re-pulls allowed). Mega-industries (>100k in
 *      scope) are pulled through the same Prospeo path — pull.ts auto-shards any
 *      filter whose page-1 total_count exceeds 24k (states, then headcount bands).
 *   4. Pull delta → score (same judge) → verify → WAL.
 *   5. net-new verified this round vs total: stop when <3% OR <25 domains OR
 *      round budget (--max-rounds, default 5).
 * Ends by resetting FINALIZE→REPORT in state.json and printing the exact
 * run-lane command to produce the updated final list. No other operator input.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, createWriteStream } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { execSync, spawnSync } from "child_process";
import { loadEnv, parseArgs, readCsv, writeCsv, normDomain, prospeoCount, prospeoSearch, mapIndustry, csvEscape } from "../../list-expander/scripts/lib";
import { fileURLToPath } from "url";
import { walAppend, JudgedRow } from "./registry";

loadEnv();
process.on("unhandledRejection", (e) => console.error("unhandled:", String(e).slice(0, 120)));
const args = parseArgs();
const LB = resolve(fileURLToPath(import.meta.url), "..");
const LX = resolve(LB, "../../list-expander/scripts");
if (!args.config || !existsSync(String(args.config))) {
  console.error("Usage: npx tsx snowball.ts --config=<lane.json> [--max-rounds=5] [--run-dir=<dir>]\n" +
    "  Sweeps every industry the lane's confirmed fits carry until a round adds <3% / <25 net-new.\n" +
    "  Run it only after run-lane.ts reports READY for the same lane.");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(String(args.config), "utf8"));
const laneId = `${cfg.client_slug}-${cfg.name}`;
const runDir = String(args["run-dir"] ?? join(homedir(), "output", "list-builder", "lanes", laneId));
const MAX_ROUNDS = Number(args["max-rounds"] ?? 5);
const ledgerPath = join(runDir, "swept-ledger.ndjson");
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Two-phase ledger (2026-07-14): a "pulled" entry is written at count time; a
// "judged" entry is written only after the round's scoring+verify land. A filter
// counts as swept ONLY when a "judged" entry exists — so a round that crashed
// between pull and judge re-pulls (free within 30d) instead of being skipped as
// "done". OLD single-phase entries (no `phase` field) are treated as judged for
// backward compatibility with existing donut ledgers.
type Ledger = { norm: string; sha: string; total_count?: number | null; pulled_rows?: number; at: string; phase?: "pulled" | "judged"; routed?: string };
function ledgerRead(): Ledger[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Ledger[];
}
function ledgerAppend(entry: Ledger): void { appendFileSync(ledgerPath, JSON.stringify(entry) + "\n"); }
function normalizeFilter(f: Record<string, unknown>): string {
  const sortDeep = (v: any): any => Array.isArray(v) ? v.map(sortDeep).sort() : (v && typeof v === "object") ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : (typeof v === "string" ? v.trim().toLowerCase() : v);
  return JSON.stringify(sortDeep(f));
}
function alreadySwept(norm: string, ledger: Ledger[]): boolean {
  // legacy entries (no phase) OR explicit "judged" entries mark a filter done
  const done = ledger.filter((l) => l.norm === norm && (l.phase === undefined || l.phase === "judged"));
  if (!done.length) return false;
  const newest = Math.max(...done.map((l) => Date.parse(l.at)));
  // identical Prospeo pulls are FREE within 30 days — only block PAID repeats
  return Date.now() - newest < 30 * 86400_000;
}

function verifiedDomains(): Set<string> {
  const s = new Set<string>();
  const vp = join(runDir, "verified.stream.csv");
  if (existsSync(vp)) for (const r of readCsv(vp)) if (r.final_verdict === "verified") s.add(r.domain);
  return s;
}

function knownDomains(): Set<string> {
  const s = new Set<string>();
  for (const f of readdirSync(runDir)) {
    if (/^pull-batch\d+-scored\.csv\.stream\.csv$/.test(f)) for (const r of readCsv(join(runDir, f))) s.add(r.domain);
  }
  return s;
}

function industriesOfConfirmed(): Map<string, number> {
  const emp = new Map<string, string>();
  for (const f of ["pull-all.csv", "enriched.csv", "candidates.csv", "lookalikes-raw.csv"]) {
    const p = join(runDir, f);
    if (!existsSync(p)) continue;
    // translate legacy LinkedIn tags to the modern Prospeo enum so the sweep pulls
    // the valid equivalent instead of erroring the whole industry set out.
    for (const r of readCsv(p)) if (r.domain && r.industry) emp.set(r.domain, mapIndustry(r.industry));
  }
  const conf = verifiedDomains();
  const tally = new Map<string, number>();
  for (const d of conf) { const ind = emp.get(d); if (ind) tally.set(ind, (tally.get(ind) ?? 0) + 1); }
  return tally;
}

// Fixed output schema for snowball-rN.csv (stream-writable header). Superset of
// prospeoCompanyRow columns + text_excerpt/source_filters so FINALIZE keeps the
// enrichment fields (blanks where absent). score-batch reads domain/name/text_excerpt; verify reads name/domain/
// industry/state/source_filters — all present.
const SNOWBALL_COLS = ["domain", "name", "industry", "employee_count", "employee_range", "revenue_range", "founded", "company_type", "country", "state", "city", "phone", "active_job_postings", "keywords", "linkedin", "text_excerpt", "source_filters"];

function qualifiedAcrossStreams(): number {
  let n = 0;
  for (const f of readdirSync(runDir)) {
    if (/^pull-batch\d+-scored\.csv\.stream\.csv$/.test(f)) for (const r of readCsv(join(runDir, f))) if (r.qualified === "true") n++;
  }
  return n;
}

function tsx(script: string, argv: string[]): number {
  // 16h: with several lanes sharing the global Prospeo limiter a big industry
  // sweep legitimately exceeds 4h; a timeout kill here is silent (no stderr)
  const r = spawnSync("npx", ["tsx", script, ...argv], { stdio: "inherit", timeout: 16 * 3600_000 });
  return r.status ?? 1;
}

async function main() {
  console.log(`snowball ${laneId} — up to ${MAX_ROUNDS} rounds`);
  const base: any = { company_location_search: { include: cfg.states?.length ? cfg.states.map((s: string) => `${s}, United States`) : ["United States #US"] }, company_headcount_custom: { min: cfg.emp_min, max: cfg.emp_max } };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const before = verifiedDomains().size;
    const ledger = ledgerRead();
    const tally = industriesOfConfirmed();
    console.log(`\n== round ${round}: ${before} verified; industries carried: ${[...tally.entries()].map(([k, v]) => `${k}(${v})`).join(", ") || "none resolvable"}`);

    // build unswept industry sets. sweptNorms records what we PULLED this round;
    // a matching "judged" ledger entry is written only after scoring+verify land.
    const sets: { label: string; filters: Record<string, unknown> }[] = [];
    const sweptNorms: string[] = [];
    for (const [ind] of tally) {
      const filters = { company_industry: { include: [ind] }, ...base };
      const norm = normalizeFilter(filters);
      if (alreadySwept(norm, ledger)) continue;
      const count = await prospeoCount("search-company", filters);
      if (count == null) continue;
      sweptNorms.push(norm);
      // Mega-industries used to be routed to a separate free index. They now go
      // through the same Prospeo pull: pull.ts auto-shards any filter over 24k
      // (country -> 50 states + DC -> headcount-band bisection), so the tail is
      // not lost and no extra source is required.
      if (count > 100_000) console.log(`  [mega] ${ind}: ${count} in scope — pull.ts will auto-shard this filter`);
      sets.push({ label: `sb${round}-${ind.slice(0, 16).replace(/\W+/g, "-").toLowerCase()}`, filters: { company_industry: { include: [ind] }, company_headcount_custom: base.company_headcount_custom } });
      ledgerAppend({ norm, sha: sha(norm), total_count: count, pulled_rows: count, at: new Date().toISOString(), phase: "pulled" });
    }
    if (!sets.length) { console.log("  nothing unswept — converged (ledger exhausted)"); break; }

    // pull (pull.ts auto-shards any >24k filter — inherited, no change needed here)
    let pullDir = "";
    if (sets.length) {
      const pullRun = `sb-${laneId}-r${round}`;
      pullDir = join(homedir(), "output", "list-expander", pullRun);
      execSync(`mkdir -p ${JSON.stringify(pullDir)}`);
      writeFileSync(join(pullDir, "winners.json"), JSON.stringify({ filter_sets: sets, base_filters: { company_location_search: base.company_location_search } }, null, 1));
      const pullCode = tsx(join(LX, "pull.ts"), [`--run=${pullRun}`]);
      // a dead pull child (OOM/kill) with no pull-all.csv must NOT read as "0 pulled → converged"
      if (pullCode !== 0 || !existsSync(join(pullDir, "pull-all.csv"))) {
        throw new Error(`pull.ts exited ${pullCode} without ${join(pullDir, "pull-all.csv")} — re-run snowball to resume (re-pulls are free 30d)`);
      }
    }
    // STREAMING dedup (item 10): iterate each source's rows, keep only a domain
    // Set in memory, append accepted rows straight to snowball-rN.csv. No full-row
    // Maps — memory stays flat regardless of round size.
    const n = 1 + readdirSync(runDir).filter((f) => /^pull-batch\d+-scored\.csv\.stream\.csv$/.test(f)).length;
    const roundCsv = join(runDir, `snowball-r${round}.csv`);
    const known = knownDomains();
    const seen = new Set<string>();
    const freshDomains: string[] = [];
    const ws = createWriteStream(roundCsv);
    ws.write(SNOWBALL_COLS.join(",") + "\n");
    let pulledCount = 0;
    const sources = [pullDir ? join(pullDir, "pull-all.csv") : ""].filter(Boolean);
    for (const src of sources) {
      for (const r of readCsv(src)) {           // one source materialized at a time, then released
        pulledCount++;
        const d = normDomain(r.domain || "");
        if (!d || known.has(d) || seen.has(d)) continue;
        seen.add(d); freshDomains.push(d);
        ws.write(SNOWBALL_COLS.map((c) => csvEscape(c === "text_excerpt" ? (r.description || r.text_excerpt || "") : (r as any)[c])).join(",") + "\n");
      }
    }
    await new Promise<void>((res) => ws.end(res));
    console.log(`  pulled ${pulledCount}, net-new to judge ${freshDomains.length}`);
    if (!freshDomains.length) { console.log("  round produced nothing new — converged"); break; }

    // score
    const scoredStream = join(runDir, `pull-batch${n}-scored.csv.stream.csv`);
    const scoreCode = tsx(join(LX, "score-batch.ts"), [`--csv=${roundCsv}`, `--prompt-file=${cfg.prompt}`, "--scrape", "--concurrency=200", `--out=${join(runDir, `pull-batch${n}-scored.csv`)}`]);
    const scoredRows = existsSync(scoredStream) ? readCsv(scoredStream).length : 0;
    if (scoreCode !== 0 && scoredRows < freshDomains.length * 0.9) {
      throw new Error(`score-batch exited ${scoreCode} (${scoredRows}/${freshDomains.length} scored) — re-run snowball to resume`);
    }

    // REJECT_AUDIT on THIS round's rejects (item 3) — rescued rows are appended
    // into scoredStream, which verify then reads alongside every other stream.
    const raScript = join(LB, "reject-audit.ts");
    if (existsSync(raScript)) {
      tsx(raScript, [`--run-dir=${runDir}`, `--prompt-file=${cfg.prompt}`, `--seeds=${(cfg.seeds ?? []).join(",")}`, `--stream-file=${scoredStream}`, `--cand-csv=${roundCsv}`, `--out=${join(runDir, `reject-audit-r${round}.csv`)}`]);
    }

    // verify
    const verifyCode = tsx(join(LX, "verify-website.ts"), [`--run=__abs__${runDir}`, `--prompt-file=${cfg.prompt}`, "--concurrency=120", "--once"]);
    const verifiedRows = existsSync(join(runDir, "verified.stream.csv")) ? readCsv(join(runDir, "verified.stream.csv")).length : 0;
    const totalQualified = qualifiedAcrossStreams();
    if (verifyCode !== 0 && verifiedRows < totalQualified * 0.9) {
      throw new Error(`verify-website exited ${verifyCode} (${verifiedRows}/${totalQualified} verified) — re-run snowball to resume`);
    }

    // scoring+verify landed → write the "judged" phase for every filter pulled this round
    const judgedAt = new Date().toISOString();
    for (const norm of sweptNorms) ledgerAppend({ norm, sha: sha(norm), at: judgedAt, phase: "judged" });

    const after = verifiedDomains().size;
    const gained = after - before;
    const pct = before ? gained / before : 1;
    console.log(`  round ${round} verified +${gained} (${(pct * 100).toFixed(1)}% growth)`);
    walAppend(runDir, freshDomains.map((d): JudgedRow => ({ domain: d, client_slug: cfg.client_slug, lane: cfg.name, verdict: "nano_rejected", source: "snowball", run_id: `snowball-r${round}` })));
    if (gained < 25 || pct < 0.03) { console.log(`  CONVERGED (gained ${gained} < 25 or ${(pct * 100).toFixed(1)}% < 3%)`); break; }
  }

  // reset downstream stages so run-lane refinalizes with the enlarged stream
  const statePath = join(runDir, "state.json");
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    for (const s of ["FINALIZE", "COUNT", "PUSH", "REPORT"]) state.stages[s] = { status: "pending" };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
  console.log(`\nsnowball done. Now run:\n  npx tsx ${join(LB, "run-lane.ts")} --config=${args.config}\n(refinalizes + recounts + reports with the expanded universe)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
