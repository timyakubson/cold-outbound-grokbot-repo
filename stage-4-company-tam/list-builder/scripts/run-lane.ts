#!/usr/bin/env tsx
/**
 * run-lane.ts — the one-command lane orchestrator (WS1, 2026-07-05).
 *
 * A future operator (Opus) runs EXACTLY:
 *     npx tsx run-lane.ts --config=<lane.json>
 * and re-runs the SAME command to resume after any failure. Nothing else.
 *
 * Stages: PRECHECK → LOOKALIKES → PULL → MERGE → SCORE → REJECT_AUDIT →
 *         VERIFY → ENRICH → FINALIZE → COUNT → PUSH → REPORT (always runs).
 *
 * Design rules (see plan 2026-07-05):
 *  - state.json written atomically; stage completion decided from ARTIFACTS
 *    (existence + row counts + input fingerprints), never process liveness.
 *  - Child scripts run in their own process group with a PROGRESS WATCHDOG:
 *    if the stage's output artifact mtime stalls > stall_min, the whole group
 *    is killed (SIGTERM → SIGKILL) and the stage retries once if retryable.
 *  - lane.json is hashed into state; config change ⇒ refuse resume unless
 *    --accept-config-change (invalidates SCORE onward).
 *  - Failed PULL ⇒ lane BLOCKED (downstream skipped; no plausible half-lists).
 *  - PUSH is gated on READY (all stages done + thresholds). summary.md line 1
 *    is READY or NOT READY with the exact next command.
 *
 * lane.json shape (all optional except name/client_slug/prompt/emp band):
 * {
 *   "name": "hedge", "client_slug": "autoworklet",
 *   "prompt": "/abs/path/prompt.txt",
 *   "emp_min": 10, "emp_max": 500,
 *   "states": ["New York", ...],            // omit for US-wide
 *   "industries": ["Investment Management"],
 *   "keywords": ["hedge fund", ...],
 *   "seeds": ["a.com", ...],
 *   "sources": {"lookalikes": true},
 *   "extra_candidates": ["/abs/path/maps-candidates.csv", ...],   // external-source CSVs (Google Maps dump,
 *                                        // Parallel.ai fan-out, any CSV you built). Columns: domain (required),
 *                                        // name, description, source, employee_headcount (optional).
 *   "destination": {"sheet_id": "...", "tab": "Hedge Funds"},   // or omit for CSV-only
 *   "thresholds": {"min_final_rows": 25, "min_verified_pct": 0.4, "max_reject_rate": 0.995},
 *   "seniorities": "Founder/Owner,C-Suite,Partner,Vice President,Head,Director",
 *   "stall_min": 10
 * }
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync, rmSync, statSync, renameSync, readdirSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";
import { spawn, execSync } from "child_process";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { loadEnv, parseArgs, readCsv, writeCsv, normDomain, prospeoSearch, prospeoCompanyRow, saveMetrics, metrics } from "../../list-expander/scripts/lib";
import { registryFetch, walAppend, registrySync, JudgedRow } from "./registry";

loadEnv();
const args = parseArgs();
const LB = resolve(fileURLToPath(import.meta.url), "..");
const LX = resolve(LB, "../../list-expander/scripts");

// ---------- config & run dir ----------
const configPath = String(args.config ?? "");
if (!configPath || !existsSync(configPath)) {
  console.error("Usage: npx tsx run-lane.ts --config=<lane.json>\n" +
    "  [--run-dir=<dir>] [--accept-config-change] [--steal-lock] [--push-anyway-i-checked]\n" +
    "  Re-run the SAME command to resume after any failure. lane.json shape is documented\n" +
    "  at the top of this file; build the judge first with make-judge.ts.\n" +
    `  (got: ${configPath || "no --config"})`);
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
for (const req of ["name", "client_slug", "prompt", "emp_min", "emp_max"]) {
  if (cfg[req] == null) die(`lane.json missing required field "${req}"`);
}
const laneId = `${cfg.client_slug}-${cfg.name}`;
const runDir = String(args["run-dir"] ?? join(homedir(), "output", "list-builder", "lanes", laneId));
mkdirSync(runDir, { recursive: true });
const configSha = sha(readFileSync(configPath, "utf8"));
const STALL_MIN = Number(cfg.stall_min ?? 10);
const STAGES = ["PRECHECK", "LOOKALIKES", "PULL", "MERGE", "SCORE", "REJECT_AUDIT", "VERIFY", "ENRICH", "FINALIZE", "COUNT", "PUSH", "REPORT"] as const;
type Stage = typeof STAGES[number];

function die(msg: string): never { console.error(`FATAL: ${msg}`); process.exit(2); }
function sha(s: string | Buffer): string { return createHash("sha256").update(s).digest("hex").slice(0, 16); }
function atomicWrite(p: string, content: string): void { const t = `${p}.tmp${process.pid}`; writeFileSync(t, content); renameSync(t, p); }
function nowIso(): string { return new Date().toISOString(); }
function fileRows(p: string): number { if (!existsSync(p)) return -1; try { return readCsv(p).length; } catch { return -1; } }
function fileSha(p: string): string { return existsSync(p) ? sha(readFileSync(p)) : ""; }

// ---------- state ----------
type StageState = { status: "pending" | "done" | "failed" | "blocked" | "skipped"; input_sha?: string; out_rows?: number; started?: string; finished?: string; error?: string; note?: string };
type State = { config_sha: string; run_id: string; stages: Record<string, StageState>; created: string };
const statePath = join(runDir, "state.json");

function loadState(): State {
  if (existsSync(statePath)) {
    try { return JSON.parse(readFileSync(statePath, "utf8")); }
    catch { die(`state.json is corrupt (${statePath}). Move it aside and re-run to start fresh.`); }
  }
  return { config_sha: configSha, run_id: `run_${Date.now().toString(36)}`, created: nowIso(), stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) };
}
let state = loadState();
function saveState(): void { atomicWrite(statePath, JSON.stringify(state, null, 2)); }
function st(stage: Stage): StageState { return state.stages[stage]; }

// config-change guard
if (state.config_sha !== configSha) {
  if (!args["accept-config-change"]) {
    die(`lane.json changed since this run started (state has ${state.config_sha}, file is ${configSha}).\n` +
        `Either start a fresh run dir (--run-dir=...) or re-run with --accept-config-change (invalidates SCORE onward).`);
  }
  for (const s of ["SCORE", "REJECT_AUDIT", "VERIFY", "ENRICH", "FINALIZE", "COUNT", "PUSH", "REPORT"] as Stage[]) state.stages[s] = { status: "pending" };
  state.config_sha = configSha;
  saveState();
  console.log("config change accepted — SCORE onward invalidated");
}

// ---------- run lock ----------
const lockDir = join(runDir, "run.lock.d");
function acquireRunLock(): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      return;
    } catch {
      const pidFile = join(lockDir, "pid");
      const oldPid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) || 0 : 0;
      let alive = false;
      if (oldPid) { try { process.kill(oldPid, 0); alive = true; } catch { alive = false; } }
      if (alive && !args["steal-lock"]) die(`lane ${laneId} already running (pid ${oldPid}). If you are SURE it is dead: --steal-lock`);
      try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* raced with release — retry */ }
      execSync("sleep 0.3");
    }
  }
  die(`could not acquire run lock after 10 attempts (${lockDir}) — remove it manually if no run-lane is alive`);
}
function releaseRunLock(): void { try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ok */ } }

// ---------- watchdog child runner ----------
/** Run a child command in its own process group; kill the group if the watched
 *  artifact's mtime stalls > stallMin. Returns exit code. */
function runChild(cmd: string, cmdArgs: string[], watchArtifact: string, stallMin = STALL_MIN, env: Record<string, string> = {}): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, RUN_METRICS_DIR: runDir, ...env } });
    const logPath = join(runDir, "child.log");
    const log = (s: string) => { try { writeFileSync(logPath, s, { flag: "a" }); } catch { /* ok */ } };
    child.stdout?.on("data", (d) => log(d.toString()));
    child.stderr?.on("data", (d) => log(d.toString()));
    let lastProgress = Date.now();
    const timer = setInterval(() => {
      try { const m = statSync(watchArtifact).mtimeMs; if (m > lastProgress) lastProgress = m; } catch { /* not yet created */ }
      try { const m = statSync(logPath).mtimeMs; if (m > lastProgress) lastProgress = m; } catch { /* ok */ }
      if (Date.now() - lastProgress > stallMin * 60_000) {
        console.error(`  watchdog: no progress on ${basename(watchArtifact)} for ${stallMin}min — killing process group ${child.pid}`);
        try { process.kill(-child.pid!, "SIGTERM"); } catch { /* gone */ }
        setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, 10_000);
      }
    }, 30_000);
    child.on("exit", (code) => { clearInterval(timer); resolvePromise(code ?? 1); });
  });
}

const RETRYABLE = /rate limit|429|network|timeout|econn|socket|fetch failed/i;

async function runStage(stage: Stage, fn: () => Promise<{ out_rows?: number; note?: string }>): Promise<boolean> {
  const s = st(stage);
  if (s.status === "done") { console.log(`✓ ${stage} (done: ${s.out_rows ?? "-"} rows)`); return true; }
  if (s.status === "skipped") { console.log(`- ${stage} (skipped: ${s.note})`); return true; }
  if (st("PULL").status === "blocked" && !["PRECHECK", "LOOKALIKES", "PULL", "REPORT"].includes(stage)) {
    s.status = "blocked"; s.note = "PULL failed — no plausible half-lists"; saveState();
    console.log(`■ ${stage} blocked (PULL failed)`); return false;
  }
  console.log(`▶ ${stage} ...`);
  s.status = "pending"; s.started = nowIso(); s.error = undefined; saveState();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fn();
      Object.assign(s, { status: "done", finished: nowIso(), out_rows: r.out_rows, note: r.note });
      saveState();
      console.log(`✓ ${stage} — ${r.note ?? `${r.out_rows ?? "?"} rows`}`);
      return true;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const retryable = RETRYABLE.test(msg);
      console.error(`✗ ${stage} attempt ${attempt + 1}: ${msg.slice(0, 300)}${retryable && attempt === 0 ? " — retrying once" : ""}`);
      if (!retryable || attempt === 1) {
        Object.assign(s, { status: stage === "PULL" ? "blocked" : "failed", finished: nowIso(), error: msg.slice(0, 500) });
        saveState();
        return false;
      }
      await new Promise((r2) => setTimeout(r2, 10_000));
    }
  }
  return false;
}

// ---------- artifacts ----------
const A = {
  lookalikes: join(runDir, "lookalikes-raw.csv"),
  pullAll: join(runDir, "pull-all.csv"),
  candidates: join(runDir, "candidates.csv"),
  skipped: join(runDir, "skipped-already-judged.csv"),
  scored: join(runDir, "pull-batch1-scored.csv"),
  scoredStream: join(runDir, "pull-batch1-scored.csv.stream.csv"),
  rejectAudit: join(runDir, "reject-audit.csv"),
  verified: join(runDir, "verified.stream.csv"),
  enriched: join(runDir, "enriched.csv"),
  final: join(runDir, "lane-final.csv"),
  removed: join(runDir, "lane-removed-band-geo.csv"),
  counts: join(runDir, "contact-count.json"),
  summary: join(runDir, "summary.md"),
};

// ---------- stage implementations ----------
async function stPrecheck() {
  const missing = ["PROSPEO_API_KEY", "OPENAI_API_KEY"].filter((k) => !process.env[k] && !process.env[k + "_NANO"]);
  if (missing.length) throw new Error(`missing env keys: ${missing.join(", ")} (put them in a .env at the repo root or ~/.env)`);
  if (!existsSync(cfg.prompt)) throw new Error(`prompt file not found: ${cfg.prompt}`);
  const ping = await prospeoSearch("search-company", { company_keywords: { include: ["test-precheck-zzz"] } });
  if (ping.error && ping.error_code !== "NO_RESULTS") throw new Error(`Prospeo unreachable/errored: ${ping.error_code}`);

  // CONFIG VALIDATION — fail here with the exact offending field, not later at PULL.
  const base: any = { company_location_search: { include: cfg.states?.length ? cfg.states.map((s: string) => `${s}, United States`) : ["United States #US"] } };
  const noBand = cfg.emp_min <= 1 && cfg.emp_max >= 100000;
  // emp band: Prospeo rejects company_headcount_custom.max > 100000 as INVALID_FILTERS.
  if (!noBand && Number(cfg.emp_max) > 100000) {
    throw new Error(`config: emp_max=${cfg.emp_max} exceeds Prospeo's 100000 ceiling. Use emp_max<=100000, or set a no-band lane (emp_min<=1 && emp_max>=100000) which omits the headcount filter.`);
  }
  // probe the band once (skip for no-band lanes, which never send a headcount filter)
  if (!noBand) {
    const bandProbe = await prospeoSearch("search-company", { company_headcount_custom: { min: cfg.emp_min, max: cfg.emp_max }, ...base });
    if (bandProbe.error && bandProbe.error_code !== "NO_RESULTS") {
      throw new Error(`config: emp band {min:${cfg.emp_min},max:${cfg.emp_max}} rejected by Prospeo [${bandProbe.error_code}]: ${bandProbe.filter_error ?? ""}`);
    }
  }
  // probe ALL industries in ONE call — a 400 names the bad value in filter_error.
  if (cfg.industries?.length) {
    const indProbe = await prospeoSearch("search-company", { company_industry: { include: cfg.industries }, ...base });
    if (indProbe.error && indProbe.error_code !== "NO_RESULTS") {
      throw new Error(`config: invalid industry in [${cfg.industries.join(", ")}] — Prospeo [${indProbe.error_code}]: ${indProbe.filter_error ?? "(check names against /prospeo-search-api; see LEGACY_INDUSTRY_MAP in list-expander lib.ts for legacy→modern)"}`);
    }
  }
  return { note: `env+prompt+Prospeo ok; config validated (band${noBand ? "=no-band" : " ok"}, ${cfg.industries?.length ?? 0} industries ok)` };
}

async function stLookalikes() {
  const seeds: string[] = (cfg.seeds ?? []).map(normDomain).filter(Boolean);
  if (!seeds.length || cfg.sources?.lookalikes === false) { st("LOOKALIKES").note = "no seeds / disabled"; return { out_rows: 0, note: "skipped (no seeds)" }; }
  const seedArg = seeds.slice(0, 20).join(",");
  const laneRunName = `lane-${laneId}`;
  const code = await runChild("npx", ["tsx", join(LX, "lookalikes.ts"), `--domains=${seedArg}`, `--run=${laneRunName}`, "--pages=2", "--exa-n=10", "--skip-parallel", `--country=United States #US`], join(homedir(), "output", "list-expander", laneRunName, "lookalikes-raw.csv"));
  const src = join(homedir(), "output", "list-expander", laneRunName, "lookalikes-raw.csv");
  if (existsSync(src)) writeFileSync(A.lookalikes, readFileSync(src));
  if (code !== 0 && !existsSync(A.lookalikes)) throw new Error(`lookalikes exited ${code} with no output`);
  return { out_rows: fileRows(A.lookalikes) };
}

async function stPull() {
  const sets: any[] = [];
  // No-band lanes (emp_min<=1 && emp_max>=100000) must OMIT the headcount filter:
  // Prospeo rejects max>100000 as INVALID_FILTERS, and any company_headcount_custom
  // silently excludes unknown-headcount companies (~16% of an SMB market, 2026-07-07).
  const noBand = cfg.emp_min <= 1 && cfg.emp_max >= 100000;
  const empFilter = noBand ? {} : { company_headcount_custom: { min: cfg.emp_min, max: cfg.emp_max } };
  for (const ind of cfg.industries ?? []) sets.push({ label: `ind-${ind.slice(0, 18).replace(/\W+/g, "-").toLowerCase()}`, filters: { company_industry: { include: [ind] }, ...empFilter } });
  for (const kw of cfg.keywords ?? []) sets.push({ label: `kw-${kw.slice(0, 18).replace(/\W+/g, "-").toLowerCase()}`, filters: { company_keywords: { include: [kw] }, ...empFilter } });
  if (!sets.length) throw new Error("lane.json has neither industries nor keywords — nothing to pull");
  const base: any = { company_location_search: { include: cfg.states?.length ? cfg.states.map((s: string) => `${s}, United States`) : ["United States #US"] } };
  atomicWrite(join(runDir, "winners.json"), JSON.stringify({ filter_sets: sets, base_filters: base }, null, 1));
  // pull.ts reads winners.json from its own outDir; point it at OUR runDir via a scoped run name
  const pullRun = `lane-${laneId}-pull`;
  const pullDir = join(homedir(), "output", "list-expander", pullRun);
  mkdirSync(pullDir, { recursive: true });
  writeFileSync(join(pullDir, "winners.json"), readFileSync(join(runDir, "winners.json")));
  const code = await runChild("npx", ["tsx", join(LX, "pull.ts"), `--run=${pullRun}`], join(pullDir, "pull-all.csv"), Math.max(STALL_MIN, 20));
  const out = join(pullDir, "pull-all.csv");
  if (!existsSync(out) || code !== 0) throw new Error(`pull exited ${code}; see ${join(runDir, "child.log")}`);
  writeFileSync(A.pullAll, readFileSync(out));
  const n = fileRows(A.pullAll);
  if (n < 1) throw new Error("pull produced 0 rows — check winners.json filters (bad industry/keyword names 400 or return nothing)");
  return { out_rows: n };
}

async function stMerge() {
  const cand = new Map<string, Record<string, string>>();
  for (const r of readCsv(A.pullAll)) if (r.domain) cand.set(r.domain, { ...r, text_excerpt: r.description || r.text_excerpt || "" });
  if (existsSync(A.lookalikes)) {
    for (const r of readCsv(A.lookalikes)) {
      if (!r.domain || r.domain.startsWith("li:") || cand.has(r.domain)) continue;
      const e = Number(r.employee_count || 0);
      if (e && (e < cfg.emp_min || e > cfg.emp_max)) continue;
      cand.set(r.domain, r);
    }
  }
  // extra_candidates: external-source CSVs (Google Maps dump, Parallel.ai fan-out,
  // ad-hoc keyword pulls, ...). Need a `domain` (or website) column; description
  // lands in text_excerpt for the judge; emp band applies only when headcount known.
  const extraFiles = [...(cfg.extra_candidates ?? [])];
  for (const p of extraFiles) {
    if (!existsSync(p)) throw new Error(`extra_candidates file missing: ${p}`);
    let added = 0;
    for (const r of readCsv(p)) {
      const d = normDomain(r.domain ?? r.website ?? "");
      if (!d || !d.includes(".") || cand.has(d)) continue;
      const e = Number(r.employee_headcount || r.employee_count || 0);
      if (e && (e < cfg.emp_min || e > cfg.emp_max)) continue;
      cand.set(d, { ...r, domain: d, name: r.name || r.company_name || d, text_excerpt: r.description || r.text_excerpt || "", source_filters: r.source || basename(p) });
      added++;
    }
    console.log(`  extra_candidates ${basename(p)}: +${added}`);
  }
  // seeds always enter the pool (the "67 missing seeds" guardrail)
  for (const s of (cfg.seeds ?? []).map(normDomain)) if (s && !cand.has(s)) cand.set(s, { domain: s, name: s, source_filters: "seed", text_excerpt: "" } as any);
  // registry dedup — VISIBLE counts, never silent
  const reg = registryFetch(cfg.client_slug, cfg.name);
  const skipped: Record<string, string>[] = [];
  for (const d of [...cand.keys()]) if (reg.domains.has(d)) { skipped.push(cand.get(d)!); cand.delete(d); }
  writeCsv(A.skipped, skipped);
  writeCsv(A.candidates, [...cand.values()]);
  return { out_rows: cand.size, note: `${cand.size} to judge, ${skipped.length} skipped-already-judged (registry mode: ${reg.mode})` };
}

async function stScore() {
  const inputSha = fileSha(A.candidates);
  if (st("SCORE").input_sha && st("SCORE").input_sha !== inputSha) console.log("  input changed — rescoring");
  st("SCORE").input_sha = inputSha; saveState();
  const code = await runChild("npx", ["tsx", join(LX, "score-batch.ts"), `--csv=${A.candidates}`, `--prompt-file=${cfg.prompt}`, "--scrape", "--concurrency=200", `--out=${A.scored}`, "--resume"], A.scoredStream, STALL_MIN);
  if (code !== 0 && fileRows(A.scoredStream) < fileRows(A.candidates) * 0.98) throw new Error(`score exited ${code} before completing (${fileRows(A.scoredStream)}/${fileRows(A.candidates)})`);
  const q = readCsv(A.scoredStream).filter((r) => r.qualified === "true").length;
  // WAL nano verdicts
  walAppend(runDir, readCsv(A.scoredStream).map((r): JudgedRow => ({
    domain: r.domain, client_slug: cfg.client_slug, lane: cfg.name,
    verdict: r.qualified === "true" ? "nano_qualified" : "nano_rejected",
    confidence: r.confidence, source: r.source_filters || "pull", name: r.name, state: r.state, run_id: state.run_id, prompt_sha: sha(readFileSync(cfg.prompt)),
  })));
  return { out_rows: q, note: `${q} qualified of ${fileRows(A.scoredStream)} scored` };
}

async function stRejectAudit() {
  const script = join(LB, "reject-audit.ts");
  if (!existsSync(script)) return { out_rows: 0, note: "skipped (reject-audit.ts not installed)" };
  const code = await runChild("npx", ["tsx", script, `--run-dir=${runDir}`, `--prompt-file=${cfg.prompt}`, `--seeds=${(cfg.seeds ?? []).join(",")}`], A.rejectAudit, STALL_MIN);
  if (code !== 0) throw new Error(`reject-audit exited ${code}`);
  const audit = existsSync(A.rejectAudit) ? readCsv(A.rejectAudit) : [];
  const rescued = audit.filter((r) => r.rescued === "true").length;
  return { out_rows: audit.length, note: `${audit.length} audited, ${rescued} rescued into stream` };
}

async function stVerify() {
  // verify-website reads pull-batch*-scored.csv.stream.csv from a run dir under list-expander outDir;
  // our runDir IS the artifact home, so run it with --run resolved via env override dir
  const code = await runChild("npx", ["tsx", join(LX, "verify-website.ts"), `--run=__abs__${runDir}`, `--prompt-file=${cfg.prompt}`, "--concurrency=120", "--once"], A.verified, STALL_MIN, {});
  if (code !== 0 && !existsSync(A.verified)) throw new Error(`verify exited ${code}`);
  const rows = readCsv(A.verified);
  const v = rows.filter((r) => r.final_verdict === "verified").length;
  walAppend(runDir, rows.map((r): JudgedRow => ({
    domain: r.domain, client_slug: cfg.client_slug, lane: cfg.name,
    verdict: r.final_verdict === "verified" ? "verified" : "verify_rejected",
    confidence: r.confidence, source: r.source_filters, name: r.name, state: r.state, run_id: state.run_id,
  })));
  return { out_rows: v, note: `${v} verified of ${rows.length}` };
}

async function stEnrich() {
  const cand = new Map(readCsv(A.candidates).map((r) => [r.domain, r]));
  const need = readCsv(A.verified).filter((r) => r.final_verdict === "verified" && !Number(cand.get(r.domain)?.employee_count || 0)).map((r) => r.domain);
  if (!need.length) return { out_rows: 0, note: "nothing to enrich" };
  const needCsv = join(runDir, "need-enrich.csv");
  writeCsv(needCsv, need.map((d) => ({ domain: d })));
  const code = await runChild("npx", ["tsx", join(LB, "enrich-domains.ts"), `--in=${needCsv}`, `--out=${A.enriched}`], A.enriched, STALL_MIN);
  if (code !== 0 && !existsSync(A.enriched)) throw new Error(`enrich exited ${code}`);
  return { out_rows: fileRows(A.enriched) };
}

async function stFinalize() {
  const cand = new Map<string, Record<string, string>>();
  const extra = readdirSync(runDir).filter((f) => /^(snowball-r\d+|enriched.*)\.csv$/.test(f)).map((f) => join(runDir, f));
  for (const f of [A.pullAll, A.lookalikes, A.enriched, ...extra]) {
    if (!existsSync(f)) continue;
    for (const r of readCsv(f)) if (r.domain && !r._not_in_prospeo) {
      const prev = cand.get(r.domain) ?? {};
      cand.set(r.domain, { ...prev, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v)) });
    }
  }
  const EAST = new Set(cfg.states ?? []);
  const final: Record<string, string>[] = [];
  const removed: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const r of readCsv(A.verified)) {
    if (r.final_verdict !== "verified" || seen.has(r.domain)) continue;
    seen.add(r.domain);
    const c = cand.get(r.domain) ?? {};
    const e = Number(c.employee_count || 0);
    const stt = c.state || r.state || "";
    const row: Record<string, string> = {
      domain: r.domain, name: r.name || c.name || "", industry: c.industry || "", employee_count: String(e || ""),
      employee_range: c.employee_range || "", revenue_range: c.revenue_range || "", founded: c.founded || "",
      city: c.city || "", state: stt, phone: c.phone || "", linkedin: c.linkedin || "",
      source_filters: r.source_filters || "", confidence: r.confidence || "", live_reason: r.live_reason || "",
    };
    // No-band lanes keep unknown-headcount rows (e=0 must not fail emp_min>=1;
    // 3,123 valid companies were silently dropped this way on 2026-07-07).
    const noBand = cfg.emp_min <= 1 && cfg.emp_max >= 100000;
    const okBand = noBand || (e >= cfg.emp_min && e <= cfg.emp_max);
    const okGeo = !cfg.states?.length || EAST.has(stt);
    if (okBand && okGeo) final.push(row);
    else removed.push({ ...row, removed_because: `emp=${e} state=${stt}` });
  }
  writeCsv(A.final, final);
  writeCsv(A.removed, removed);
  return { out_rows: final.length, note: `${final.length} final, ${removed.length} band/geo removed` };
}

async function stCount() {
  const rows = readCsv(A.final);
  const TWO = new Set(["co.uk", "com.au"]);
  const clean = rows.filter((r) => { const p = r.domain.split("."); return !(p.length > 2 && !TWO.has(p.slice(-2).join("."))); });
  const rootCsv = join(runDir, "lane-final-root.csv");
  writeCsv(rootCsv, clean);
  const code = await runChild("npx", ["tsx", join(LX, "contact-count.ts"), `--csv=${rootCsv}`, `--run=__abs__${runDir}`, `--seniorities=${cfg.seniorities ?? "Founder/Owner,C-Suite,Partner,Vice President,Head,Director"}`], A.counts, Math.max(STALL_MIN, 15));
  if (code !== 0 || !existsSync(A.counts)) throw new Error(`contact-count exited ${code}`);
  const c = JSON.parse(readFileSync(A.counts, "utf8"));
  return { out_rows: c.total_verified_email, note: `${c.total_people} people / ${c.total_verified_email} verified emails` };
}

function readiness(): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const s of ["PULL", "MERGE", "SCORE", "VERIFY", "FINALIZE"] as Stage[]) if (st(s).status !== "done") reasons.push(`${s} is ${st(s).status}`);
  const finalRows = fileRows(A.final);
  const t = cfg.thresholds ?? {};
  if (finalRows < (t.min_final_rows ?? 10)) reasons.push(`final rows ${finalRows} < min_final_rows ${t.min_final_rows ?? 10}`);
  const scored = fileRows(A.scoredStream); const q = st("SCORE").out_rows ?? 0;
  if (scored > 0 && 1 - q / scored > (t.max_reject_rate ?? 0.998)) reasons.push(`reject rate ${(1 - q / scored).toFixed(3)} above max — judge or filters likely broken`);
  const ver = st("VERIFY").out_rows ?? 0;
  if (q > 0 && ver / q < (t.min_verified_pct ?? 0.2)) reasons.push(`verified ${ver}/${q} below min_verified_pct`);
  return { ready: reasons.length === 0, reasons };
}

async function stPush() {
  const r = readiness();
  if (!r.ready && !args["push-anyway-i-checked"]) throw new Error(`NOT READY: ${r.reasons.join("; ")} (override only with --push-anyway-i-checked)`);
  const dest = cfg.destination ?? {};
  if (!dest.sheet_id) return { out_rows: fileRows(A.final), note: "CSV-only destination (lane-final.csv)" };
  execSync(`python3 ${join(LB, "push-sheet.py")} ${JSON.stringify(dest.sheet_id)} ${JSON.stringify(dest.tab ?? cfg.name)} ${JSON.stringify(A.final)} ${JSON.stringify(A.counts)}`, { stdio: "inherit", timeout: 300_000 });
  return { out_rows: fileRows(A.final), note: `pushed to sheet tab "${dest.tab ?? cfg.name}"` };
}

async function stReport() {
  try { const sync = registrySync(runDir); console.log(`  registry sync: ${JSON.stringify(sync)}`); } catch (e) { console.error(`  registry sync failed (WAL retained): ${String(e).slice(0, 100)}`); }
  saveMetrics(runDir, { lane: laneId });
  const r = readiness();
  const lines: string[] = [];
  lines.push(r.ready ? `# READY — ${laneId}` : `# NOT READY — ${laneId}`);
  if (!r.ready) {
    lines.push("", "## Why not ready");
    for (const reason of r.reasons) lines.push(`- ${reason}`);
    lines.push("", "## Next command", "```", `npx tsx ${join(LB, "run-lane.ts")} --config=${configPath}`, "```", "(the same command resumes; fix nothing by hand unless a stage says so)");
  }
  lines.push("", "## Stages");
  for (const s of STAGES) {
    const x = st(s);
    lines.push(`- ${s}: ${x.status}${x.out_rows != null ? ` (${x.out_rows})` : ""}${x.note ? ` — ${x.note}` : ""}${x.error ? ` — ERROR: ${x.error.slice(0, 160)}` : ""}`);
  }
  const m = existsSync(join(runDir, "run-metrics.json")) ? JSON.parse(readFileSync(join(runDir, "run-metrics.json"), "utf8")) : {};
  lines.push("", "## Cost/telemetry", `- Prospeo requests: ${m.prospeo_requests ?? 0} (rate-limit hits: ${m.prospeo_rate_limits ?? 0})`, `- Nano calls: ${m.nano_calls ?? 0}`, `- Homepage fetches: ${m.homepage_fetches ?? 0}`);
  lines.push("", "## Artifacts", `- Final: ${A.final} (${fileRows(A.final)} rows)`, `- Removed: ${A.removed} (${fileRows(A.removed)})`, `- Skipped already-judged: ${A.skipped} (${fileRows(A.skipped)})`, `- Counts: ${A.counts}`);
  atomicWrite(A.summary, lines.join("\n") + "\n");
  console.log(`\n${lines[0]}\nsummary → ${A.summary}`);
  return { note: r.ready ? "READY" : "NOT READY" };
}

// ---------- main ----------
(async () => {
  acquireRunLock();
  try {
    console.log(`run-lane ${laneId} | run dir: ${runDir} | run id: ${state.run_id}`);
    const precheckOk = await runStage("PRECHECK", stPrecheck);
    if (precheckOk) {
      await runStage("LOOKALIKES", stLookalikes);
      await runStage("PULL", stPull);
    } else {
      // A failed PRECHECK is a config/env error — block PULL now (fail-fast) rather
      // than wasting a full pull on a filter Prospeo will reject anyway.
      const p = st("PULL");
      if (p.status !== "done") { p.status = "blocked"; p.note = `PRECHECK ${st("PRECHECK").status} — fix lane.json/env, then re-run`; saveState(); console.log("■ PULL blocked (PRECHECK failed)"); }
    }
    await runStage("MERGE", stMerge);
    await runStage("SCORE", stScore);
    await runStage("REJECT_AUDIT", stRejectAudit);
    await runStage("VERIFY", stVerify);
    await runStage("ENRICH", stEnrich);
    await runStage("FINALIZE", stFinalize);
    await runStage("COUNT", stCount);
    await runStage("PUSH", stPush);
  } finally {
    // REPORT always re-runs — a "done" from a previous (possibly failed) run must
    // never leave a stale summary.md describing the wrong run.
    state.stages["REPORT"] = { status: "pending" }; saveState();
    await runStage("REPORT", stReport).catch((e) => console.error("REPORT failed:", e));
    releaseRunLock();
  }
  process.exit(readiness().ready ? 0 : 1);
})();
