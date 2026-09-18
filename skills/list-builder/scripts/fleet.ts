#!/usr/bin/env tsx
/**
 * fleet.ts — read-only lane observability (WS12, 2026-07-14).
 *
 *     npx tsx fleet.ts                 # scan ~/output/list-builder/lanes/*
 *     npx tsx fleet.ts --root=/abs/dir # scan a different lanes root
 *     npx tsx fleet.ts --json          # machine-readable
 *
 * One row per lane: current stage, that stage's status, rows in the newest
 * stream file, minutes since anything in the run dir was last written, whether
 * a snowball is in flight, and READY / NOT READY (from summary.md line 1).
 *
 * ZERO side effects — never writes, never touches a run dir. Safe to run against
 * lanes with live run-lane / snowball processes.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parseArgs } from "../../list-expander/scripts/lib";

const args = parseArgs();
const root = String(args.root ?? join(homedir(), "output", "list-builder", "lanes"));
const STAGES = ["PRECHECK", "LOOKALIKES", "PULL", "MERGE", "SCORE", "REJECT_AUDIT", "VERIFY", "ENRICH", "FINALIZE", "COUNT", "PUSH", "REPORT"];

function countRows(p: string): number {
  try {
    const t = readFileSync(p, "utf8");
    let n = 0, i = t.indexOf("\n"); // skip header
    for (; i >= 0 && i < t.length - 1; i = t.indexOf("\n", i + 1)) n++;
    return n; // data rows (header excluded)
  } catch { return -1; }
}

function newestStream(dir: string): { file: string; rows: number; mtime: number } | null {
  let best: { file: string; rows: number; mtime: number } | null = null;
  for (const f of readdirSync(dir)) {
    if (!/\.stream\.csv$|^snowball-r\d+\.csv$|^pull-all\.csv$|^lane-final\.csv$/.test(f)) continue;
    try {
      const m = statSync(join(dir, f)).mtimeMs;
      if (!best || m > best.mtime) best = { file: f, rows: countRows(join(dir, f)), mtime: m };
    } catch { /* vanished */ }
  }
  return best;
}

function latestMtime(dir: string): number {
  let latest = 0;
  for (const f of readdirSync(dir)) {
    try { const m = statSync(join(dir, f)).mtimeMs; if (m > latest) latest = m; } catch { /* ok */ }
  }
  return latest;
}

type Row = { lane: string; stage: string; status: string; rows: number; idle_min: number; snowball: boolean; ready: string };

function scanLane(dir: string): Row | null {
  const lane = dir.split("/").pop() ?? dir;
  let stage = "?", status = "?";
  const statePath = join(dir, "state.json");
  if (existsSync(statePath)) {
    try {
      const st = JSON.parse(readFileSync(statePath, "utf8"));
      // current stage = last stage that is done, or first non-done
      let cur = STAGES[0];
      for (const s of STAGES) {
        const ss = st.stages?.[s];
        if (!ss) continue;
        if (ss.status === "done" || ss.status === "skipped") cur = s;
        else { cur = s; break; }
      }
      stage = cur; status = st.stages?.[cur]?.status ?? "?";
    } catch { status = "corrupt-state"; }
  }
  const ns = newestStream(dir);
  const idleMs = Date.now() - latestMtime(dir);
  const snowball = readdirSync(dir).some((f) => /^snowball-r\d+\.csv$/.test(f) || f === "swept-ledger.ndjson");
  let ready = "—";
  const summ = join(dir, "summary.md");
  if (existsSync(summ)) {
    const l1 = readFileSync(summ, "utf8").split("\n")[0] ?? "";
    ready = l1.startsWith("# READY") ? "READY" : l1.startsWith("# NOT READY") ? "NOT READY" : "—";
  }
  return { lane, stage, status, rows: ns?.rows ?? -1, idle_min: Math.round(idleMs / 60000), snowball, ready };
}

function main() {
  if (!existsSync(root)) { console.error(`no lanes root at ${root}`); process.exit(1); }
  const rows: Row[] = [];
  for (const d of readdirSync(root)) {
    const dir = join(root, d);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    if (!existsSync(join(dir, "state.json")) && !existsSync(join(dir, "summary.md")) && !existsSync(join(dir, "swept-ledger.ndjson"))) continue;
    const r = scanLane(dir);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => a.lane.localeCompare(b.lane));
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log(`no lanes found under ${root}`); return; }
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
  console.log(pad("LANE", 34) + pad("STAGE", 14) + pad("STATUS", 11) + pad("ROWS", 9) + pad("IDLE(min)", 11) + pad("SNOWBALL", 10) + "READY");
  console.log("-".repeat(99));
  for (const r of rows) {
    console.log(
      pad(r.lane, 34) + pad(r.stage, 14) + pad(r.status, 11) +
      pad(r.rows < 0 ? "-" : String(r.rows), 9) + pad(String(r.idle_min), 11) +
      pad(r.snowball ? "yes" : "-", 10) + r.ready
    );
  }
}
main();
