#!/usr/bin/env tsx
/**
 * Grade a lead list across 8 quality dimensions before sending.
 *
 * Usage:
 *   npx tsx scripts/score-list.ts --list=leads.csv [--icp-file=client-profile.yaml] [--out=scorecard.md]
 */

import { readFileSync, writeFileSync } from "fs";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    list: get("--list"),
    icpFile: get("--icp-file"),
    out: get("--out"),
  };
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQ = !inQ;
      } else if (c === "," && !inQ) {
        cols.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
    cols.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").replace(/^"|"$/g, "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function getField(row: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) if (row[c]) return row[c];
  return "";
}

const BAD_TITLE_PATTERNS = [
  /\bintern(ship)?\b/i,
  /\bassistant\b/i,
  /\bcoordinator\b/i,
  /\bstudent\b/i,
  /\bpart.time\b/i,
  /\bretired\b/i,
  /\btrainee\b/i,
];

const CATCH_ALL_LOCAL_PARTS = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "sales",
  "team",
  "support",
  "admin",
  "noreply",
  "no-reply",
  "office",
  "marketing",
]);

function isCatchAll(email: string): boolean {
  const local = (email.split("@")[0] || "").toLowerCase();
  return CATCH_ALL_LOCAL_PARTS.has(local);
}

function isLikelyFakeName(first: string, last: string): boolean {
  if (!first || !last) return true;
  if (first.toUpperCase() === first && first.length > 2) return true; // ALL CAPS
  if (/\d/.test(first) || /\d/.test(last)) return true;
  const fakes = new Set(["admin", "info", "contact", "test", "user", "n/a", "na"]);
  if (fakes.has(first.toLowerCase()) || fakes.has(last.toLowerCase())) return true;
  return false;
}

function letterGrade(score: number): string {
  if (score >= 93) return "A+";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function main() {
  const { list, icpFile, out } = parseArgs();
  if (!list) {
    console.error("Usage: --list=leads.csv [--icp-file=profile.yaml] [--out=scorecard.md]");
    process.exit(1);
  }

  const { rows } = parseCsv(readFileSync(list, "utf8"));
  const total = rows.length;
  if (total === 0) {
    console.error("Empty list.");
    process.exit(1);
  }

  // Load ICP
  let icpTitles: string[] = [];
  let icpIndustries: string[] = [];
  let icpHeadcountMin = 0;
  let icpHeadcountMax = Infinity;
  if (icpFile) {
    const text = readFileSync(icpFile, "utf8");
    const titleMatch = text.match(/job_titles:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (titleMatch) icpTitles = titleMatch[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    const indMatch = text.match(/industries_in:\s*\n((?:\s+-\s+.+\n?)+)/);
    if (indMatch) icpIndustries = indMatch[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    const minMatch = text.match(/headcount_min:\s*(\d+)/);
    if (minMatch) icpHeadcountMin = Number(minMatch[1]);
    const maxMatch = text.match(/headcount_max:\s*(\d+)/);
    if (maxMatch) icpHeadcountMax = Number(maxMatch[1]);
  }

  // Dimension 1: Email verification coverage (requires verified_status col)
  const verifiedCount = rows.filter((r) => {
    const s = (r.email_status || r.verification_status || r.mv_status || "").toLowerCase();
    return s === "ok" || s === "verified" || s === "valid";
  }).length;
  // If no verification column exists, assume 0 (penalize heavily for not verifying)
  const hasVerificationCol = rows.some((r) => r.email_status || r.verification_status || r.mv_status);
  const verificationScore = hasVerificationCol ? Math.round((verifiedCount / total) * 100) : 0;

  // Dimension 2: Duplicate emails
  const emailSet = new Set<string>();
  let dupeEmails = 0;
  for (const r of rows) {
    const e = (r.email || "").toLowerCase();
    if (!e) continue;
    if (emailSet.has(e)) dupeEmails++;
    emailSet.add(e);
  }
  const dupePct = (dupeEmails / total) * 100;
  const dupeScore = Math.max(0, Math.round(100 - dupePct * 20));

  // Dimension 3: Duplicate domains
  const domainCounts: Record<string, number> = {};
  for (const r of rows) {
    const d = (r.company_domain || r.email?.split("@")[1] || "").toLowerCase();
    if (d) domainCounts[d] = (domainCounts[d] || 0) + 1;
  }
  const domains = Object.keys(domainCounts);
  const avgPerDomain = domains.length ? total / domains.length : 0;
  const overConcentrated = Object.values(domainCounts).filter((n) => n > 5).length;
  const domainScore = avgPerDomain < 2 ? 100 : avgPerDomain < 5 ? 60 : 30;

  // Dimension 4: Title relevance (vs ICP titles)
  let titleRelevant = 0;
  if (icpTitles.length) {
    const tLower = icpTitles.map((t) => t.toLowerCase());
    for (const r of rows) {
      const t = (getField(r, ["job_title", "title"]) || "").toLowerCase();
      if (t && tLower.some((i) => t.includes(i.toLowerCase()) || i.toLowerCase().includes(t.split(" ")[0]))) {
        titleRelevant++;
      }
    }
  }
  const titleRelevanceScore = icpTitles.length ? Math.round((titleRelevant / total) * 100) : -1;

  // Dimension 5: Bad-title detection
  let badTitles = 0;
  for (const r of rows) {
    const t = getField(r, ["job_title", "title"]);
    if (BAD_TITLE_PATTERNS.some((p) => p.test(t))) badTitles++;
  }
  const badTitlePct = (badTitles / total) * 100;
  const badTitleScore = Math.max(0, Math.round(100 - badTitlePct * 10));

  // Dimension 6: Catch-all density
  let catchAlls = 0;
  for (const r of rows) if (isCatchAll(r.email || "")) catchAlls++;
  const catchAllPct = (catchAlls / total) * 100;
  const catchAllScore = catchAllPct < 5 ? 100 : catchAllPct < 15 ? Math.round(100 - (catchAllPct - 5) * 5) : 0;

  // Dimension 7: ICP fit (industry + headcount)
  let icpFitCount = 0;
  if (icpIndustries.length || icpHeadcountMin > 0) {
    for (const r of rows) {
      const ind = (r.company_industry || "").toLowerCase();
      const hc = Number(r.company_headcount || 0);
      const indMatch = icpIndustries.length === 0 || icpIndustries.some((i) => ind.includes(i.toLowerCase()));
      const hcMatch = hc === 0 || (hc >= icpHeadcountMin && hc <= icpHeadcountMax);
      if (indMatch && hcMatch) icpFitCount++;
    }
  }
  const icpFitScore = icpIndustries.length || icpHeadcountMin > 0 ? Math.round((icpFitCount / total) * 100) : -1;

  // Dimension 8: Name quality
  let fakeNames = 0;
  for (const r of rows) {
    if (isLikelyFakeName(r.first_name || "", r.last_name || "")) fakeNames++;
  }
  const nameScore = Math.round(((total - fakeNames) / total) * 100);

  // Weighted average — verification and ICP fit counted 2x
  const dims: { name: string; score: number; weight: number }[] = [
    { name: "Email verification", score: verificationScore, weight: 2 },
    { name: "Duplicate emails", score: dupeScore, weight: 1 },
    { name: "Duplicate domains", score: domainScore, weight: 1 },
    { name: "Title relevance", score: titleRelevanceScore, weight: 1.5 },
    { name: "Bad-title detection", score: badTitleScore, weight: 1 },
    { name: "Catch-all density", score: catchAllScore, weight: 1 },
    { name: "ICP fit", score: icpFitScore, weight: 2 },
    { name: "Name quality", score: nameScore, weight: 1 },
  ];
  const applicable = dims.filter((d) => d.score >= 0);
  const totalWeight = applicable.reduce((s, d) => s + d.weight, 0);
  const weightedSum = applicable.reduce((s, d) => s + d.score * d.weight, 0);
  const overall = Math.round(weightedSum / totalWeight);
  const grade = letterGrade(overall);

  // Top issues
  const issues: string[] = [];
  if (!hasVerificationCol) issues.push("No email verification column — run through MillionVerifier before sending");
  if (verificationScore < 100 && hasVerificationCol) {
    issues.push(`${total - verifiedCount} emails unverified (${(100 - verificationScore).toFixed(1)}%) — run verification`);
  }
  if (dupeEmails > 0) issues.push(`${dupeEmails} duplicate emails (${dupePct.toFixed(1)}%) — deduplicate before upload`);
  if (catchAlls > 0) issues.push(`${catchAlls} leads on catch-all addresses (${catchAllPct.toFixed(1)}%) — drop or deprioritize`);
  if (badTitles > 0) issues.push(`${badTitles} bad titles (${badTitlePct.toFixed(1)}%) — filter by seniority in Prospeo`);
  if (overConcentrated > 0) issues.push(`${overConcentrated} domains have >5 leads each — cap at 2-3 per domain`);
  if (icpFitScore >= 0 && icpFitScore < 80) issues.push(`${total - icpFitCount} leads outside declared ICP (${(100 - icpFitScore).toFixed(1)}%) — filter by industry + headcount`);
  if (fakeNames > total * 0.05) issues.push(`${fakeNames} rows with likely-fake names — review and drop`);
  const topIssues = issues.slice(0, 5);

  // Render report
  const lines: string[] = [];
  lines.push(`# List Quality Scorecard\n`);
  lines.push(`**File:** ${list}`);
  lines.push(`**Rows:** ${total}`);
  lines.push(`**Grade:** ${grade} (${overall}/100)\n`);
  lines.push(`## Dimensions\n`);
  let n = 1;
  for (const d of dims) {
    const s = d.score >= 0 ? `${d.score}/100` : "n/a (data missing)";
    lines.push(`${n}. ${d.name.padEnd(22)} ${s}`);
    n++;
  }
  lines.push(`\n## Top ${Math.min(topIssues.length, 5)} issues to fix\n`);
  topIssues.forEach((i, idx) => lines.push(`${idx + 1}. ${i}`));
  lines.push(`\n## Pre-send checklist\n`);
  lines.push(`- [ ] Deduplicate by email`);
  lines.push(`- [ ] Run MillionVerifier if any emails unverified`);
  lines.push(`- [ ] Drop catch-all addresses if density >5%`);
  lines.push(`- [ ] Filter bad titles (intern, assistant, coordinator, student, retired)`);
  lines.push(`- [ ] Cap per-domain concentration at 2-3 leads`);
  lines.push(`- [ ] Re-run this scorecard after filtering`);
  lines.push(`- [ ] If final grade <C, rebuild list instead of sending\n`);

  const report = lines.join("\n");
  if (out) writeFileSync(out, report);
  console.log(report);
}

main();
