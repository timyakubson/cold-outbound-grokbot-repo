/**
 * judged_domains registry — WAL-first with opportunistic Supabase sync (WS5).
 *
 * Design (from 2026-07-05 review): the per-run ndjson WAL is the source of
 * truth for the run; the Postgres table `list_builder_judged_domains` (any
 * Postgres/Supabase database, via LIST_REGISTRY_DB_URL) is the cross-run
  * index. Reads for dedup = Postgres rows + any unsynced local WAL tails.
 * Never a silent CSV fallback — if Supabase is unreachable, say so loudly and
 * return WAL-only results (the caller's summary must show which mode ran).
 *
 * Verdict stages: nano_qualified | nano_rejected | verified | verify_rejected | enrich_failed
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { loadEnv } from "../../list-expander/scripts/lib";

export type JudgedRow = {
  domain: string;            // normalized apex used as dedup key
  domain_raw?: string;
  client_slug: string;
  lane: string;
  verdict: "nano_qualified" | "nano_rejected" | "verified" | "verify_rejected" | "enrich_failed";
  confidence?: number | string;
  prompt_sha?: string;
  source?: string;           // pull | lookalike | sweep | seed | maps | getleads
  name?: string;
  employee_count?: number | string;
  state?: string;
  judged_at?: string;
  run_id?: string;
};

const WAL_NAME = "judged.wal.ndjson";
const SYNC_MARK = "judged.wal.synced";     // stores line count already synced

export function walAppend(runDir: string, rows: JudgedRow[]): void {
  if (!rows.length) return;
  const now = new Date().toISOString();
  appendFileSync(join(runDir, WAL_NAME), rows.map((r) => JSON.stringify({ judged_at: now, ...r })).join("\n") + "\n");
}

export function walRead(runDir: string): JudgedRow[] {
  const p = join(runDir, WAL_NAME);
  if (!existsSync(p)) return [];
  const rows: JudgedRow[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn final line — tolerated */ }
  }
  return rows;
}

function dbUrl(): string | null {
  // OPTIONAL. A Postgres connection string (Supabase or anything else) holding the
  // cross-run `list_builder_judged_domains` table. DDL: references/registry-schema.sql.
  // Unset ⇒ the registry degrades to WAL-only (per-run dedup still works).
  return process.env.LIST_REGISTRY_DB_URL ?? null;
}

function psql(sql: string): string {
  const url = dbUrl();
  if (!url) throw new Error("LIST_REGISTRY_DB_URL not set");
  // SQL goes via STDIN and the URL via env — nothing is interpolated into the
  // shell, so backticks/$/quotes in company names can't break or inject.
  return execSync(`psql "$REGISTRY_DB_URL" -v ON_ERROR_STOP=1 -t -A -f -`, {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 120_000,
    input: sql, env: { ...process.env, REGISTRY_DB_URL: url },
  });
}

/** Fetch the set of domains already judged for a client (any lane unless given). */
export function registryFetch(clientSlug: string, lane?: string): { domains: Set<string>; mode: "db" | "wal-only" } {
  const domains = new Set<string>();
  let mode: "db" | "wal-only" = "db";
  if (!dbUrl()) {
    console.error("registry: LIST_REGISTRY_DB_URL not set — WAL-ONLY dedup (cross-run dedup disabled)");
    mode = "wal-only";
  } else try {
    const where = lane ? `client_slug='${clientSlug}' AND lane='${lane}'` : `client_slug='${clientSlug}'`;
    for (const line of psql(`SELECT domain FROM list_builder_judged_domains WHERE ${where};`).split("\n")) {
      if (line.trim()) domains.add(line.trim());
    }
  } catch (e) {
    console.error(`⚠️ registry: registry DB unreachable (${String(e).slice(0, 80)}) — WAL-ONLY dedup this run`);
    mode = "wal-only";
  }
  // union all unsynced WAL tails across run dirs for this client
  const roots = [join(homedir(), "output", "list-expander"), join(homedir(), "output", "list-builder")];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      const runDir = join(root, d);
      if (!existsSync(join(runDir, WAL_NAME))) continue;
      for (const r of walRead(runDir)) if (r.client_slug === clientSlug && (!lane || r.lane === lane)) domains.add(r.domain);
    }
  }
  return { domains, mode };
}

/** Idempotently sync a run dir's WAL to Supabase (upsert on PK). Safe to re-run. */
export function registrySync(runDir: string): { synced: number; skipped: number; note?: string } {
  if (!dbUrl()) return { synced: 0, skipped: 0, note: "skipped: LIST_REGISTRY_DB_URL not set" };
  const rows = walRead(runDir);
  const markPath = join(runDir, SYNC_MARK);
  const already = existsSync(markPath) ? Number(readFileSync(markPath, "utf8")) || 0 : 0;
  const todo = rows.slice(already);
  if (!todo.length) return { synced: 0, skipped: rows.length };
  // A domain legitimately appears multiple times in the WAL (nano verdict, then
  // verify verdict). One INSERT can't upsert the same PK twice — keep the LAST
  // row per key (verdicts only ever progress forward).
  const latest = new Map<string, JudgedRow>();
  // Empty-domain rows (CSV multiline artifacts) violate the NOT NULL PK — skip them.
  for (const r of todo) if (r.domain && r.domain.includes(".")) latest.set(`${r.domain}|${r.client_slug}|${r.lane}`, r);
  const deduped = [...latest.values()];
  const esc = (v: unknown) => v == null || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v != null ? String(n) : "NULL"; };
  for (let i = 0; i < deduped.length; i += 500) {
    const values = deduped.slice(i, i + 500).map((r) =>
      `(${esc(r.domain)},${esc(r.domain_raw ?? r.domain)},${esc(r.client_slug)},${esc(r.lane)},${esc(r.verdict)},${num(r.confidence)},${esc(r.prompt_sha)},${esc(r.source)},${esc(r.name)},${num(r.employee_count)},${esc(r.state)},${esc(r.judged_at)},${esc(r.run_id)})`
    ).join(",");
    psql(`INSERT INTO list_builder_judged_domains
      (domain, domain_raw, client_slug, lane, verdict, confidence, prompt_sha, source, name, employee_count, state, judged_at, run_id)
      VALUES ${values}
      ON CONFLICT (domain, client_slug, lane) DO UPDATE SET
        verdict = EXCLUDED.verdict, confidence = EXCLUDED.confidence, prompt_sha = EXCLUDED.prompt_sha,
        source = EXCLUDED.source, name = EXCLUDED.name, employee_count = EXCLUDED.employee_count,
        state = EXCLUDED.state, judged_at = EXCLUDED.judged_at, run_id = EXCLUDED.run_id;`);
  }
  writeFileSync(markPath, String(rows.length));
  return { synced: todo.length, skipped: already };
}

// CLI: npx tsx registry.ts sync <runDir> | fetch <client> [lane]
if (process.argv[1]?.split("/").pop() === "registry.ts") {
  loadEnv();
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "sync") console.log(JSON.stringify(registrySync(a)));
  else if (cmd === "fetch") { const r = registryFetch(a, b); console.log(JSON.stringify({ mode: r.mode, count: r.domains.size })); }
  else console.error("usage: registry.ts sync <runDir> | fetch <client> [lane]");
}
