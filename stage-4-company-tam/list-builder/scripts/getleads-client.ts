#!/usr/bin/env tsx
/**
 * Minimal MCP-over-HTTP client for GetLeads, so scripts can call it without a
 * live MCP session. Speaks JSON-RPC 2.0 to POST https://app.getleads.io/api/mcp:
 * initialize (capturing the mcp-session-id header) → notifications/initialized →
 * tools/call. Responses may be SSE (data: {...} lines) or plain JSON — both handled.
 *
 * Key: env GETLEADS_API_KEY (sign up at https://getleads.io), else the getleads
 * mcpServers Authorization header in ~/.claude.json (read-only).
 * OPTIONAL: with no key, `hasGetleadsKey()` returns false and callers skip the
 * GetLeads lane instead of failing.
 *
 * CLI:
 *   npx tsx getleads-client.ts count  '<json-args>'
 *   npx tsx getleads-client.ts export '<json-args>' --out=file.csv
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { sleep } from "../../list-expander/scripts/lib";

const ENDPOINT = "https://app.getleads.io/api/mcp";

function resolveKey(): string | null {
  if (process.env.GETLEADS_API_KEY) return process.env.GETLEADS_API_KEY.replace(/^Bearer\s+/i, "");
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
    const auth = findAuth(cfg);
    if (auth) return auth.replace(/^Bearer\s+/i, "");
  } catch { /* fall through */ }
  return null;
}

/** True when a GetLeads key is available. Callers use this to SKIP the lane. */
export function hasGetleadsKey(): boolean { return resolveKey() != null; }

function findAuth(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.getleads?.headers?.Authorization) return String(obj.getleads.headers.Authorization);
  for (const v of Object.values(obj)) { const f = findAuth(v); if (f) return f; }
  return null;
}

const KEY = resolveKey();
function requireKey(): string {
  if (!KEY) throw new Error("GETLEADS_API_KEY not set (and no getleads entry in ~/.claude.json) — sign up at https://getleads.io");
  return KEY;
}
let sessionId: string | null = null;
let initialized = false;
let rpcId = 1;

function parseRpcBody(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("data:") || /\r?\ndata:/.test(trimmed)) {
    const dataLines = trimmed.split(/\r?\n/).filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim()).filter((l) => l && l !== "[DONE]");
    const last = dataLines[dataLines.length - 1];
    return last ? JSON.parse(last) : {};
  }
  return JSON.parse(trimmed);
}

async function post(payload: any, expectResult: boolean): Promise<any> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify(payload),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  const text = await res.text();
  if (!expectResult) return null;
  const json = parseRpcBody(text);
  if (json.error) throw new Error(`GetLeads RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function ensureInit(): Promise<void> {
  if (initialized) return;
  await post({
    jsonrpc: "2.0", id: rpcId++, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "list-builder", version: "1.0" } },
  }, true);
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, false);
  initialized = true;
}

/** Call a tool; unwraps result.content[0].text (a JSON string) when present. */
export async function getleadsCall(name: string, args: Record<string, unknown>): Promise<any> {
  await ensureInit();
  const result = await post({ jsonrpc: "2.0", id: rpcId++, method: "tools/call", params: { name, arguments: args } }, true);
  const text = result?.content?.[0]?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

function extractCount(res: any): number {
  if (typeof res === "number") return res;
  if (res && typeof res === "object") {
    for (const k of ["total_matching", "count", "total", "total_count", "totalCount", "exportable_rows", "contacts", "result", "value"]) {
      if (typeof res[k] === "number") return res[k];
    }
  }
  const n = Number(res);
  return Number.isFinite(n) ? n : NaN;
}

export async function getleadsCount(args: Record<string, unknown>): Promise<number> {
  return extractCount(await getleadsCall("count_contacts", args));
}

export async function getleadsSearch(args: Record<string, unknown>): Promise<any> {
  return getleadsCall("search_contacts", args);
}

export async function getleadsExportToCsv(args: Record<string, unknown>, outPath: string): Promise<number> {
  const start = await getleadsCall("export_contacts", { ...args, confirmed: true });
  // Tool-level validation errors (e.g. "Invalid seniority value(s)") come back as
  // {ok:false, message:...} in content — NOT as an RPC error. Without this check the
  // poll loop below spins 30 min and throws a generic timeout that hides the real cause.
  if (start && typeof start === "object" && (start.ok === false || start.error)) {
    throw new Error(`export_contacts rejected: ${JSON.stringify(start).slice(0, 400)}`);
  }
  let exportId = start?.export_id ?? start?.id ?? start?.exportId ?? start?.export?.id;
  let url: string | null = start?.export_url ?? start?.url ?? null;
  for (let i = 0; i < 180 && !url; i++) {
    await sleep(10_000);
    const chk = await getleadsCall("check_contact_export", exportId ? { export_id: exportId } : {});
    const status = chk?.status ?? chk?.state;
    url = chk?.export_url ?? chk?.url ?? null;
    if (!exportId) exportId = chk?.export_id ?? chk?.id ?? exportId;
    if (status === "failed" || status === "error") throw new Error(`export failed: ${JSON.stringify(chk).slice(0, 300)}`);
    if ((status === "completed" || status === "done") && url) break;
  }
  if (!url) throw new Error("export did not produce a download URL in time");
  const res = await fetch(url);
  const csv = await res.text();
  writeFileSync(outPath, csv);
  return Math.max(0, csv.trim().split("\n").length - 1);
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const [cmd, jsonArgs] = process.argv.slice(2);
    const outArg = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
    const args = jsonArgs ? JSON.parse(jsonArgs) : {};
    if (!KEY) { console.error("No GetLeads key: set GETLEADS_API_KEY in .env (sign up at https://getleads.io)"); process.exit(1); }
    if (cmd === "count") {
      const n = await getleadsCount(args);
      console.log(n);
    } else if (cmd === "export") {
      if (!outArg) { console.error("export needs --out=file.csv"); process.exit(1); }
      const rows = await getleadsExportToCsv(args, outArg);
      console.log(`${rows} rows → ${outArg}`);
    } else {
      console.error("Usage: getleads-client.ts count '<json-args>' | export '<json-args>' --out=file.csv");
      process.exit(1);
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
