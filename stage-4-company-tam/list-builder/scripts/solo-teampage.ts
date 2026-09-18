#!/usr/bin/env tsx
/**
 * Targeted solo detector for a judge-rescued bucket.
 * Fetches homepage + team/attorneys pages, counts named attorneys via nano.
 * Drops ONLY confident solos (exactly one attorney named). Ambiguous is kept.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { mapConcurrent, normDomain, loadEnv } from "../../list-expander/scripts/lib";

loadEnv();
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.join("=") || "true"]; }));
if (!args.csv || !args.out) {
  console.error("Usage: npx tsx solo-teampage.ts --csv=in.csv --out=out.csv [--limit=N] [--concurrency=30]\n" +
    "  Input needs `domain` and `name` columns. Drops only confident single-person firms.");
  process.exit(1);
}
const inCsv = String(args.csv);
const outCsv = String(args.out);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CONC = Number(args.concurrency ?? 30);
const KEY = process.env.OPENAI_API_KEY_NANO ?? process.env.OPENAI_API_KEY!;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PATHS = ["/attorneys", "/our-attorneys", "/attorney", "/our-team", "/team", "/our-people", "/people", "/lawyers", "/our-firm", "/meet-the-team", "/attorneys-and-staff", "/firm/attorneys"];

function stripHtml(h: string): string {
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
async function grab(url: string): Promise<string> {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ctl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}
function teamLinks(html: string, base: string): string[] {
  const out: string[] = []; const re = /href=["']([^"']+)["']/gi; let m;
  while ((m = re.exec(html)) && out.length < 4) {
    const href = m[1];
    if (/attorney|lawyer|our-team|\/team|our-people|\/people|professionals|our-firm|meet/i.test(href)) {
      try { out.push(new URL(href, base).href); } catch {}
    }
  }
  return [...new Set(out)];
}
async function collectText(domain: string): Promise<{ text: string; teamFetched: boolean }> {
  const base = `https://${domain}`;
  const home = await grab(base) || await grab(`http://${domain}`);
  if (!home) return { text: "", teamFetched: false };
  // Homepage capped so a real team/attorneys page always gets room (prevents
  // false-solo when homepage shows 1 name but the roster lives on /attorneys).
  let text = stripHtml(home).slice(0, 2500);
  let teamFetched = false;
  const links = teamLinks(home, base);
  const tried = new Set<string>();
  for (const u of links) { tried.add(u); const h = await grab(u); if (h && stripHtml(h).length > 200) { text += "\n\n== " + u + " ==\n" + stripHtml(h); teamFetched = true; } if (text.length > 12000) break; }
  if (text.length < 12000) {
    for (const p of PATHS) {
      const u = base + p; if (tried.has(u)) continue;
      const h = await grab(u); if (h && stripHtml(h).length > 200) { text += "\n\n== " + u + " ==\n" + stripHtml(h); teamFetched = true; }
      if (text.length > 12000) break;
    }
  }
  return { text: text.slice(0, 12000), teamFetched };
}
async function nano(name: string, domain: string, text: string): Promise<any> {
  const prompt = `You are counting attorneys at a US law firm from its website text (homepage + team/attorneys pages when available).\nCount how many DISTINCT licensed attorneys/lawyers/partners/associates are NAMED (people with a first+last name presented as attorneys). Ignore non-attorney staff (paralegals, office/operations managers, receptionists).\nRespond ONLY JSON: {"named_attorneys": <integer>, "names": "<comma-separated names you counted, or note>", "solo": true|false}.\nsolo = true ONLY if exactly ONE attorney is named AND there is no sign of any other attorney. If the page text is missing/thin or you cannot tell how many attorneys there are, set solo=false (do NOT guess a firm is solo without evidence).`;
  const body = { model: "gpt-5-nano", messages: [
    { role: "system", content: "Return ONLY the JSON object." },
    { role: "user", content: `${prompt}\n\n---\nFIRM: ${name} (${domain})\nWEBSITE TEXT:\n${text.slice(0, 11000)}\n\nJSON only.` },
  ], response_format: { type: "json_object" }, reasoning_effort: "minimal" };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
      if (!r.ok) { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); continue; }
      const j: any = await r.json();
      return JSON.parse(j.choices[0].message.content);
    } catch { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); }
  }
  return null;
}

(async () => {
  const lines = readFileSync(inCsv, "utf8").trim().split("\n");
  const header = lines[0].split(",");
  const di = header.indexOf("domain"), ni = header.indexOf("name");
  let rows = lines.slice(1).map((l) => { const c = l.split(","); return { domain: c[di], name: c[ni] }; });
  if (LIMIT !== Infinity) rows = rows.slice(0, LIMIT);
  const stream = outCsv + ".stream.csv";
  const done = new Set<string>();
  if (existsSync(stream)) for (const l of readFileSync(stream, "utf8").trim().split("\n").slice(1)) done.add(l.split(",")[0]);
  else writeFileSync(stream, "domain,name,named_attorneys,drop_solo,team_fetched,textlen,names\n");
  const todo = rows.filter((r) => !done.has(normDomain(r.domain)));
  console.log(`solo-teampage: ${todo.length} to check (concurrency ${CONC}); ${done.size} already done`);
  let n = 0, solos = 0, err = 0;
  await mapConcurrent(todo, CONC, async (row) => {
    const dom = normDomain(row.domain);
    const { text, teamFetched } = await collectText(dom);
    const v = text ? await nano(row.name, dom, text) : null;
    // DROP only when confident: a real team/attorneys page was fetched AND exactly one attorney named.
    const dropSolo = v?.solo === true && teamFetched && Number(v?.named_attorneys) === 1;
    if (v == null) err++; if (dropSolo) solos++;
    const csvSafe = (s: string) => `"${String(s ?? "").replace(/"/g, "'").replace(/\n/g, " ").slice(0, 120)}"`;
    appendFileSync(stream, `${dom},${csvSafe(row.name)},${v?.named_attorneys ?? ""},${dropSolo},${teamFetched},${text.length},${csvSafe(v?.names ?? (text ? "" : "NO_TEXT"))}\n`);
    if (++n % 25 === 0) console.log(`  ${n}/${todo.length} | drop-solos=${solos} err=${err}`);
  });
  console.log(`DONE: checked ${n}, confident-drop-solos=${solos}, fetch/judge-errors=${err} → ${stream}`);
})();
