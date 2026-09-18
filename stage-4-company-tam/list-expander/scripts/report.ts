#!/usr/bin/env tsx
/**
 * Phase 5b — Transparency report. Renders a single-file HTML report from the
 * run artifacts: seeds fingerprint → lookalikes → filter scorecard → final
 * qualified TAM → verified-email ceiling. This is the "show the client
 * exactly how the list was built" deliverable.
 *
 * Usage:
 *   npx tsx report.ts --run=medical-groups --title="Multi-Site Medical Groups — TAM Expansion" \
 *     [--qualified=pull-all-scored.csv]
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { loadEnv, parseArgs, readCsv, outDir, maybeHelp } from "./lib";

maybeHelp(`
report.ts — Phase 5b: single-file HTML transparency report from the run artifacts.

  npx tsx report.ts --run=<slug> --title="<Vertical> — TAM Expansion" [--qualified=pull-all-scored.csv]

Reads whatever exists in <run>/ (fingerprint.json, lookalikes-*.csv,
filter-scorecard.json, verified.stream.csv, contact-count.json) and writes
<run>/report.html. No API keys needed.
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);
const title = String(args.title ?? `List Expansion Report — ${run}`);

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const maybe = <T,>(path: string, fn: (raw: string) => T): T | null =>
  existsSync(path) ? fn(readFileSync(path, "utf8")) : null;

const fingerprint = maybe(join(dir, "fingerprint.json"), JSON.parse) as any[] | null;
const scorecard = maybe(join(dir, "filter-scorecard.json"), JSON.parse) as any[] | null;
const contactCount = maybe(join(dir, "contact-count.json"), JSON.parse) as any | null;
const lookalikes = existsSync(join(dir, "lookalikes-raw.csv")) ? readCsv(join(dir, "lookalikes-raw.csv")) : null;
const confirmed = existsSync(join(dir, "lookalikes-confirmed.csv")) ? readCsv(join(dir, "lookalikes-confirmed.csv")) : null;
const qualifiedPath = join(dir, String(args.qualified ?? "pull-all-scored.csv"));
const qualified = existsSync(qualifiedPath)
  ? readCsv(qualifiedPath).filter((r) => !("qualified" in r) || r.qualified === "true")
  : null;
const verifiedStream = existsSync(join(dir, "verified.stream.csv")) ? readCsv(join(dir, "verified.stream.csv")) : null;

function table(rows: Record<string, unknown>[], cols: string[], headers?: string[]): string {
  return `<table><thead><tr>${(headers ?? cols).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const sections: string[] = [];

if (fingerprint) {
  const inP = fingerprint.filter((f) => f.prospeo_found).length;
  const withSite = fingerprint.filter((f) => f.homepage_text).length;
  sections.push(`<section><h2>1 · Seed companies &amp; how the database sees them</h2>
  <p>We started from ${fingerprint.length} companies we <em>know</em> fit the profile, then checked how each is actually tagged. ${inP}/${fingerprint.length} were findable in the company database; ${withSite}/${fingerprint.length} had readable websites. <strong>That gap is why naive keyword searches under-count the market</strong> — good-fit companies often aren't tagged with the "obvious" keyword, so we mine the filters from what these companies actually carry instead of guessing.</p>
  ${table(fingerprint, ["domain", "prospeo_industry", "prospeo_keywords", "prospeo_headcount", "prospeo_state"], ["Domain", "Industry", "Keywords", "Headcount", "State"])}</section>`);
}

if (lookalikes) {
  const bySource: Record<string, number> = {};
  for (const r of lookalikes) for (const s of (r.source ?? "").split("+")) bySource[s] = (bySource[s] ?? 0) + 1;
  sections.push(`<section><h2>2 · Lookalike expansion</h2>
  <p>Each seed was fed into three independent lookalike engines (Prospeo similar-company graph, Exa website-content similarity, Parallel.ai entity search). Combined and deduped: <strong>${lookalikes.length} candidate companies</strong> (${Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(", ")}).${confirmed ? ` After AI review of each candidate's website: <strong>${confirmed.length} confirmed fits</strong>.` : ""}</p></section>`);
}

if (scorecard) {
  sections.push(`<section><h2>3 · Filter scorecard — what we tested and how it performed</h2>
  <p>From the confirmed companies we extracted every industry tag and keyword pattern they actually carry, then tested each as a search filter: how many companies it returns (volume) and what share of a 25-company sample truly fit (precision). Filters kept for the final pull are the ones with both meaningful volume and high precision.</p>
  ${table(scorecard, ["type", "value", "prospeo_count", "precision", "est_qualified_yield"], ["Type", "Filter", "Companies matched", "Sampled precision", "Est. qualified companies"])}</section>`);
}

if (verifiedStream) {
  const n = (v: string) => verifiedStream.filter((r) => r.final_verdict === v).length;
  sections.push(`<section><h2>Live-website verification</h2>
  <p>Every AI-qualified company's website was then fetched <em>live</em> and re-judged on its current content. Of ${verifiedStream.length} qualified companies: <strong>${n("verified")} verified real (${Math.round(n("verified") / verifiedStream.length * 100)}%)</strong> · ${n("dead")} dead sites · ${n("suspended-parked")} suspended/parked · ${n("live-not-match")} live but no longer matching the profile. Database records lag reality — roughly 1 in 10 "qualified" companies had a dead or ghost website and was removed before it could reach a sending list.</p></section>`);
}

if (qualified) {
  const topIndustries = Object.entries(qualified.reduce((m: Record<string, number>, r) => { m[r.industry ?? ""] = (m[r.industry ?? ""] ?? 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  sections.push(`<section><h2>4 · Final qualified list</h2>
  <p>Union of the winning filters, deduped, every company's website evidence scored by AI against the profile: <strong>${qualified.length} qualified companies</strong>.</p>
  <p>Top industries: ${topIndustries.map(([k, v]) => `${esc(k)} (${v})`).join(" · ")}</p></section>`);
}

if (contactCount) {
  sections.push(`<section><h2>5 · Contactable TAM (verified emails)</h2>
  <p>Across the qualified companies, at the target titles${contactCount.titles ? ` (${esc(contactCount.titles)})` : ""}: <strong>${contactCount.total_people.toLocaleString()} matching people</strong>, of which <strong>${contactCount.total_verified_email.toLocaleString()} have a verified email</strong> — that's the realistic sending ceiling for this vertical.</p></section>`);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:960px;margin:40px auto;padding:0 24px;color:#191310;background:#F1EADC}
h1{font-size:28px;border-bottom:3px solid #C8102E;padding-bottom:12px}
h2{font-size:20px;margin-top:36px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;background:#fff}
th,td{border:1px solid #d8cfc0;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#191310;color:#F1EADC}
tr:nth-child(even){background:#faf6ee}
p{line-height:1.5}
.meta{color:#6b6257;font-size:13px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">Generated ${new Date().toISOString().slice(0, 10)} · run: ${esc(run)}</p>
${sections.join("\n") || "<p>No artifacts found in run dir — run the pipeline phases first.</p>"}
</body></html>`;

const out = join(dir, "report.html");
writeFileSync(out, html);
console.log(`Report → ${out} (${sections.length} sections)`);
