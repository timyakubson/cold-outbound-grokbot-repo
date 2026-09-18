/**
 * Shared helpers for the list-expander skill.
 * Dependency-free (node >= 18 native fetch). Run scripts with `npx tsx`.
 *
 * Env loading: reads the repo-root .env (walking up from this file), then the
 * current working directory's .env, then ~/.env. Process env wins over all.
 */
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync, rmdirSync, renameSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

// ---------- run telemetry (WS8) ----------
// In-process counters; any script can call saveMetrics(runDir) at exit to
// merge them into <runDir>/run-metrics.json (additive across processes).
export const metrics = {
  prospeo_requests: 0,
  prospeo_rate_limits: 0,
  nano_calls: 0,
  homepage_fetches: 0,
  started_at: new Date().toISOString(),
};

export function saveMetrics(runDir: string, extra: Record<string, unknown> = {}): void {
  try {
    const p = join(runDir, "run-metrics.json");
    let prev: any = {};
    try { prev = JSON.parse(readFileSync(p, "utf8")); } catch { /* first write */ }
    const merged: any = { ...prev, ...extra, updated_at: new Date().toISOString() };
    for (const k of ["prospeo_requests", "prospeo_rate_limits", "nano_calls", "homepage_fetches"]) {
      merged[k] = (Number(prev[k]) || 0) + (metrics as any)[k];
    }
    const tmp = p + `.tmp${process.pid}`;
    writeFileSync(tmp, JSON.stringify(merged, null, 2));
    renameSync(tmp, p);
  } catch (e) { console.error("saveMetrics failed:", e); }
}


// Child processes auto-report counters when an orchestrator sets RUN_METRICS_DIR
process.on("exit", () => { if (process.env.RUN_METRICS_DIR) { try { saveMetrics(process.env.RUN_METRICS_DIR); } catch { /* ok */ } } });

// ---------- env ----------
export function envFileCandidates(): string[] {
  const files: string[] = [];
  // Walk up from the running script (skills/<skill>/scripts/) to the repo-root .env.
  // process.argv[1] works under both CJS and ESM hosts, unlike import.meta.url.
  let d = dirname(process.argv[1] ?? process.cwd());
  for (let i = 0; i < 6; i++) { files.push(join(d, ".env")); d = dirname(d); }
  files.push(join(process.cwd(), ".env"));
  files.push(join(homedir(), ".env"));
  return [...new Set(files)];
}

export function loadEnv(): void {
  const files = envFileCandidates();
  for (const f of files) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name} — add it to the repo-root .env (see .env.example) or ~/.env`);
    process.exit(1);
  }
  return v;
}

/** Read an optional key. Returns "" and logs a skip line when unset, so a lane
 *  that depends on it can be skipped instead of hard-failing the whole run. */
export function optionalEnv(name: string, lane: string): string {
  const v = process.env[name];
  if (!v) { console.log(`  skipped: ${name} not set (${lane})`); return ""; }
  return v;
}

/** Print `text` and exit 0 when --help/-h is passed. Call at the top of a script. */
export function maybeHelp(text: string): void {
  if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
    console.log(text.trim());
    process.exit(0);
  }
}

// Cloudflare 403s default UAs on several vendors — always send a browser UA.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function httpJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}
): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);
  if (url.includes("api.openai.com")) metrics.nano_calls++;
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA, ...opts.headers },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
    if (!res.ok && json && !json.error) json._http_status = res.status;
    return json;
  } finally {
    clearTimeout(t);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- args ----------
export function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

// ---------- csv ----------
export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(path: string, rows: Record<string, unknown>[], columns?: string[]): void {
  if (!rows.length) { writeFileSync(path, ""); return; }
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  mkdirSync(dirname(path), { recursive: true });
  // write in chunks — one joined string tops out at V8's ~512MB string limit
  // (RangeError: Invalid string length) on 500k+ row pulls
  writeFileSync(path, cols.join(",") + "\n");
  const CHUNK = 20_000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\n");
    appendFileSync(path, part + "\n");
  }
}

/** Minimal CSV parser (handles quoted fields). Returns array of objects keyed by header. */
export function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let cur: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ""])));
}

// ---------- domain normalization ----------
export function normDomain(input: string): string {
  return (input || "")
    .trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .split("/")[0].split("?")[0];
}

// ---------- Prospeo ----------
const PROSPEO_BASE = "https://api.prospeo.io";

// Cross-process slot-reservation rate limiter (2026-07-05).
// The Prospeo account limit (~150 req/min) is GLOBAL — two processes each
// self-pacing at 450ms jointly trip it. All processes reserve send slots
// through ~/.cache/prospeo-lock/: an mkdir lock (held ~1ms, never during HTTP)
// guards slot.json {next_free_at, penalty_until}. A 429 anywhere writes a
// shared 45s penalty that every process (and restarts) honors.
const PROSPEO_LOCK_DIR = join(homedir(), ".cache", "prospeo-lock");
const PROSPEO_LOCK = join(PROSPEO_LOCK_DIR, "lock.d");
const PROSPEO_SLOT = join(PROSPEO_LOCK_DIR, "slot.json");
const PROSPEO_MIN_INTERVAL = 450; // hard floor; env can only make it SLOWER

function prospeoInterval(): number {
  const env = Number(process.env.PROSPEO_MIN_INTERVAL_MS ?? PROSPEO_MIN_INTERVAL);
  if (env < PROSPEO_MIN_INTERVAL) {
    console.error(`⚠️ PROSPEO_MIN_INTERVAL_MS=${env} below the ${PROSPEO_MIN_INTERVAL}ms floor — clamping (account limit is global; see lib.ts)`);
    return PROSPEO_MIN_INTERVAL;
  }
  return env;
}

async function withProspeoLock<T>(fn: () => T): Promise<T> {
  mkdirSync(PROSPEO_LOCK_DIR, { recursive: true });
  for (;;) {
    try { mkdirSync(PROSPEO_LOCK); break; } catch {
      try {
        const age = Date.now() - statSync(PROSPEO_LOCK).mtimeMs;
        if (age > 5000) { try { rmdirSync(PROSPEO_LOCK); } catch { /* raced */ } }
      } catch { /* lock vanished between EEXIST and stat — retry */ }
      await sleep(15 + Math.random() * 35);
    }
  }
  try { return fn(); } finally { try { rmdirSync(PROSPEO_LOCK); } catch { /* already removed */ } }
}

function readSlot(): { next_free_at: number; penalty_until: number } {
  try { return JSON.parse(readFileSync(PROSPEO_SLOT, "utf8")); } catch { return { next_free_at: 0, penalty_until: 0 }; }
}

function writeSlot(slot: { next_free_at: number; penalty_until: number }): void {
  const tmp = PROSPEO_SLOT + `.tmp${process.pid}`;
  writeFileSync(tmp, JSON.stringify(slot));
  renameSync(tmp, PROSPEO_SLOT);
}

/** Reserve the next global send slot; returns the epoch-ms time we may fire. */
async function reserveProspeoSlot(): Promise<number> {
  const interval = prospeoInterval();
  return withProspeoLock(() => {
    const slot = readSlot();
    const myTurn = Math.max(Date.now(), slot.next_free_at, slot.penalty_until);
    writeSlot({ ...slot, next_free_at: myTurn + interval });
    return myTurn;
  });
}

/** Record a shared rate-limit penalty all processes must honor. */
async function recordProspeoPenalty(ms = 45_000): Promise<void> {
  await withProspeoLock(() => {
    const slot = readSlot();
    writeSlot({ ...slot, penalty_until: Math.max(slot.penalty_until, Date.now() + ms) });
  });
}

/** Generic rate-limited Prospeo call (any endpoint, raw body).
 *  Same global slot pacing + shared 429 penalty as prospeoSearch.
 *  Use for enrich-person / account-information etc. Returns raw JSON. */
export async function prospeoRequest(endpoint: string, body: unknown): Promise<any> {
  const key = requireEnv("PROSPEO_API_KEY");
  let d: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    const myTurn = await reserveProspeoSlot();
    const wait = myTurn - Date.now();
    if (wait > 0) await sleep(wait);
    metrics.prospeo_requests++;
    d = await httpJson(`${PROSPEO_BASE}/${endpoint}`, {
      headers: { "X-KEY": key },
      body,
      timeoutMs: 90_000,
    }).catch((e) => ({ error: true, error_code: "NETWORK", filter_error: String(e?.message ?? e) }));
    const status = d?._http_status;
    const msg = `${d?.error_code ?? ""} ${d?.filter_error ?? ""} ${d?.message ?? ""}`.toLowerCase();
    const rateLimited = status === 429 || msg.includes("rate limit") || msg.includes("rate_limit");
    if (!rateLimited && d?.error_code !== "NETWORK" && !(status >= 500)) break;
    if (rateLimited) {
      metrics.prospeo_rate_limits++;
      await recordProspeoPenalty();
      await sleep(45_000);
    } else {
      await sleep(1500 * (attempt + 1));
    }
  }
  return d;
}

/** Rate-limited call to /search-company or /search-person.
 *  Pacing is GLOBAL across all processes via the slot file (450ms floor).
 *  Retries 429/5xx with shared backoff. */
export async function prospeoSearch(
  endpoint: "search-company" | "search-person",
  filters: Record<string, unknown>,
  page = 1
): Promise<{ error: boolean; error_code?: string; filter_error?: string; results: any[]; total_count: number | null; free?: boolean }> {
  const key = requireEnv("PROSPEO_API_KEY");
  let d: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    const myTurn = await reserveProspeoSlot();
    const wait = myTurn - Date.now();
    if (wait > 0) await sleep(wait);
    metrics.prospeo_requests++;
    if (process.env.PROSPEO_DEBUG_SLOTS) console.error(`[slot] pid=${process.pid} fire=${Date.now()}`);
    d = await httpJson(`${PROSPEO_BASE}/${endpoint}`, {
      headers: { "X-KEY": key },
      body: { page, filters },
      timeoutMs: 90_000,
    }).catch((e) => ({ error: true, error_code: "NETWORK", filter_error: String(e?.message ?? e) }));
    const status = d?._http_status;
    const msg = `${d?.error_code ?? ""} ${d?.filter_error ?? ""}`.toLowerCase();
    const rateLimited = status === 429 || msg.includes("rate limit") || msg.includes("rate_limit");
    if (!rateLimited && d?.error_code !== "NETWORK" && !(status >= 500)) break;
    if (rateLimited) {
      metrics.prospeo_rate_limits++;
      await recordProspeoPenalty(); // every process honors this, incl. after restarts
      await sleep(45_000);
    } else {
      await sleep(1500 * (attempt + 1));
    }
  }
  return {
    error: !!d.error && d.error_code !== "NO_RESULTS",
    error_code: d.error_code,
    filter_error: d.filter_error,
    results: d.results ?? [],
    total_count: d.error_code === "NO_RESULTS" ? 0 : d.pagination?.total_count ?? null,
    free: d.free,
  };
}

/** Free-ish count: page 1 call, read pagination.total_count. */
export async function prospeoCount(
  endpoint: "search-company" | "search-person",
  filters: Record<string, unknown>
): Promise<number | null> {
  const r = await prospeoSearch(endpoint, filters);
  if (r.error) {
    console.error(`Prospeo count error [${r.error_code}]: ${r.filter_error ?? ""} for ${JSON.stringify(filters).slice(0, 200)}`);
    return null;
  }
  return r.total_count;
}

export function prospeoCompanyRow(item: any): Record<string, unknown> {
  const c = item.company ?? item;
  return {
    name: c.name ?? "",
    domain: normDomain(c.domain ?? c.website ?? ""),
    industry: c.industry ?? "",
    employee_count: c.employee_count ?? c.headcount ?? "",
    employee_range: c.employee_range ?? "",
    revenue_range: c.revenue_range_printed ?? "",
    founded: c.founded ?? "",
    company_type: c.type ?? "",
    country: c.location?.country ?? c.country ?? "",
    state: c.location?.state ?? "",
    city: c.location?.city ?? "",
    phone: c.phone_hq?.phone_hq_national ?? c.phone_hq?.phone_hq ?? "",
    active_job_postings: c.job_postings?.active_count ?? "",
    description: (c.description ?? "").replace(/\s+/g, " ").slice(0, 600),
    keywords: Array.isArray(c.keywords) ? c.keywords.join("; ") : c.keywords ?? "",
    linkedin: c.linkedin_url ?? c.linkedin ?? "",
  };
}

// ---------- legacy industry tags → modern Prospeo enum ----------
// Prospeo rejects the old LinkedIn industry labels with INVALID_FILTERS, which
// silently kills an industry sweep (a sweep reads the industry
// tag off confirmed companies, which may carry legacy labels from lookalike or
// third-party sources). Every value below was probed live against Prospeo
// /search-company and returns a non-null count (2026-07-14). Keys are the legacy
// labels; add only names verified valid on the RIGHT.
export const LEGACY_INDUSTRY_MAP: Record<string, string> = {
  "Manufacturing": "General Manufacturing",
  "Retail": "General Retail",
  "Health, Wellness and Fitness": "Wellness and Fitness Services",
  "Apparel & Fashion": "Retail Apparel and Fashion",
  "Food & Beverages": "Food and Beverage Services",
  "E-Learning": "E-Learning Providers",
  "Leisure, Travel & Tourism": "Travel Arrangements",
  "Entertainment": "Entertainment Providers",
  "Information Technology and Services": "IT Services and IT Consulting",
  "Hospital & Health Care": "Hospitals and Health Care",
  "Computer Software": "Software Development",
  "Marketing and Advertising": "Advertising Services",
  "Nonprofit Organization Management": "Non-profit Organizations",
  "Non-profit Organization Management": "Non-profit Organizations",
  "Staffing & Recruiting": "Staffing and Recruiting",
  "Oil & Energy": "Oil, Gas, and Mining",
  "Oil and Gas": "Oil, Gas, and Mining",
};
const LEGACY_INDUSTRY_MAP_LC: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_INDUSTRY_MAP).map(([k, v]) => [k.toLowerCase(), v])
);
/** Translate a legacy LinkedIn industry tag to the modern Prospeo enum.
 *  Exact match first, then case-insensitive; unknown names pass through
 *  unchanged (so a genuinely-modern tag is never mangled). */
export function mapIndustry(name: string): string {
  if (!name) return name;
  if (LEGACY_INDUSTRY_MAP[name]) return LEGACY_INDUSTRY_MAP[name];
  const lc = LEGACY_INDUSTRY_MAP_LC[name.toLowerCase()];
  return lc ?? name;
}

// ---------- US states (for >24k Prospeo filter sharding) ----------
// company_location_search wants "<State>, United States"; this is the shard set
// used when a single filter exceeds Prospeo's ~24k result ceiling.
export const US_STATES: string[] = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
  "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming",
];

// ---------- homepage scrape ----------
/** Fetch + strip one URL. Returns null on any failure/non-2xx. 20s timeout. */
async function grabPage(url: string): Promise<{ rawLen: number; title: string; metaDesc: string; ogDesc: string; body: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? "";
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i)?.[1] ?? "";
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { rawLen: html.length, title: title.trim(), metaDesc: metaDesc.trim(), ogDesc: ogDesc.trim(), body };
  } catch {
    return null;
  }
}

async function grabWithProto(base: string, path = "/"): Promise<Awaited<ReturnType<typeof grabPage>>> {
  for (const proto of ["https", "http"]) {
    const p = await grabPage(`${proto}://${base}${path}`);
    if (p) return p;
  }
  return null;
}

export async function fetchHomepageText(domain: string, maxChars = 4000): Promise<string> {
  metrics.homepage_fetches++; // one per invocation, not per sub-request
  const home = await grabWithProto(domain, "/");
  if (!home) return "";

  const jsHeavy = home.rawLen > 30_000 && home.body.length < 400;
  let result = jsHeavy
    ? `[JS-HEAVY SITE] TITLE: ${home.title}\nMETA: ${home.metaDesc}\nOG: ${home.ogDesc}\nBODY: ${home.body}`
    : `TITLE: ${home.title}\nMETA: ${home.metaDesc}\nBODY: ${home.body}`;

  // Thin homepage — pull an about/company page for real body text.
  if (home.body.length < 400) {
    for (const path of ["/about", "/about-us", "/company"]) {
      const sub = await grabWithProto(domain, path);
      if (sub && sub.body.length > 400) {
        result += `\n\n[${path}] ${sub.body}`;
        break;
      }
    }
  }

  return result.slice(0, maxChars);
}

// ---------- misc ----------
export function outDir(sub: string): string {
  // "__abs__/some/path" lets orchestrators point scripts at an arbitrary run dir
  const d = sub.startsWith("__abs__") ? sub.slice(7) : join(homedir(), "output", "list-expander", sub);
  mkdirSync(d, { recursive: true });
  return d;
}

export async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
