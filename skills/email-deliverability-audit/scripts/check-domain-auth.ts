#!/usr/bin/env tsx
/**
 * Check SPF/DKIM/DMARC for a set of sending domains.
 *
 * Usage:
 *   npx tsx scripts/check-domain-auth.ts --from-csv=/tmp/audit/inboxes.csv --out=/tmp/audit/auth.csv
 *   npx tsx scripts/check-domain-auth.ts --domains=a.co,b.co --out=/tmp/audit/auth.csv
 *
 * CSV input must have a column named `domain` or `email` (domain extracted from email).
 * DKIM selector defaults to "default" (Zapmail convention). Override with --dkim-selector=XYZ.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  return {
    csv: get("--from-csv"),
    domains: get("--domains"),
    out: get("--out") ?? "/tmp/audit/auth.csv",
    dkimSelector: get("--dkim-selector") ?? "default",
  };
}

function dig(name: string): string {
  try {
    return execSync(`dig TXT ${name} +short`, { timeout: 10000 }).toString().trim();
  } catch (err) {
    return "";
  }
}

interface AuthRow {
  domain: string;
  spf_present: boolean;
  spf_strict: boolean;
  spf_record: string;
  dkim_present: boolean;
  dkim_selector: string;
  dmarc_present: boolean;
  dmarc_policy: string;
  dmarc_record: string;
  notes: string;
}

function check(domain: string, dkimSelector: string): AuthRow {
  const spfRaw = dig(domain);
  const dkimRaw = dig(`${dkimSelector}._domainkey.${domain}`);
  const dmarcRaw = dig(`_dmarc.${domain}`);

  const spfMatches = spfRaw.split("\n").filter((l) => l.includes("v=spf1"));
  const spf = spfMatches[0]?.replace(/^"|"$/g, "") ?? "";
  const spf_present = spf.length > 0;
  const spf_strict = spf.includes("-all");

  const dkim_present = dkimRaw.includes("v=DKIM1") || dkimRaw.includes("p=");

  const dmarcMatches = dmarcRaw.split("\n").filter((l) => l.includes("v=DMARC1"));
  const dmarc = dmarcMatches[0]?.replace(/^"|"$/g, "") ?? "";
  const dmarc_present = dmarc.length > 0;
  const dmarc_policy =
    dmarc.match(/p=(\w+)/)?.[1] ?? (dmarc_present ? "unknown" : "");

  const notes: string[] = [];
  if (!spf_present) notes.push("SPF missing — add `v=spf1 include:<provider> ~all`");
  else if (!spf_strict) notes.push("SPF loose (~all or +all) — consider -all once confirmed");
  if (!dkim_present) notes.push(`DKIM missing at ${dkimSelector}._domainkey`);
  if (!dmarc_present) notes.push("DMARC missing — add `v=DMARC1; p=none; rua=mailto:...`");
  else if (dmarc_policy === "none") notes.push("DMARC policy=none — no enforcement yet");

  return {
    domain,
    spf_present,
    spf_strict,
    spf_record: spf,
    dkim_present,
    dkim_selector: dkimSelector,
    dmarc_present,
    dmarc_policy,
    dmarc_record: dmarc,
    notes: notes.join("; "),
  };
}

function toCsv(rows: AuthRow[]): string {
  const header = [
    "domain",
    "spf_present",
    "spf_strict",
    "dkim_present",
    "dkim_selector",
    "dmarc_present",
    "dmarc_policy",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      header
        .map((k) => {
          const v = (r as any)[k];
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

async function main() {
  const { csv, domains: dArg, out, dkimSelector } = parseArgs();

  let domains: string[] = [];
  if (dArg) {
    domains = dArg.split(",").map((d) => d.trim()).filter(Boolean);
  } else if (csv) {
    const text = readFileSync(csv, "utf8").trim();
    const lines = text.split("\n");
    const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const domainCol = header.indexOf("domain");
    const emailCol = header.indexOf("email");
    const set = new Set<string>();
    for (const line of lines.slice(1)) {
      const cols = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
      if (domainCol >= 0 && cols[domainCol]) set.add(cols[domainCol]);
      else if (emailCol >= 0 && cols[emailCol]) {
        const d = cols[emailCol].split("@")[1];
        if (d) set.add(d);
      }
    }
    domains = [...set];
  } else {
    console.error("Provide --from-csv=path or --domains=a.co,b.co");
    process.exit(1);
  }

  console.error(`Checking ${domains.length} domains...`);
  const rows: AuthRow[] = [];
  for (let i = 0; i < domains.length; i++) {
    rows.push(check(domains[i], dkimSelector));
    if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${domains.length}`);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(rows));
  const missingSpf = rows.filter((r) => !r.spf_present).length;
  const missingDkim = rows.filter((r) => !r.dkim_present).length;
  const missingDmarc = rows.filter((r) => !r.dmarc_present).length;
  const policyNone = rows.filter((r) => r.dmarc_policy === "none").length;

  console.error(`\nWrote ${out}`);
  console.error(`  ${domains.length} domains checked`);
  console.error(`  ${missingSpf} missing SPF`);
  console.error(`  ${missingDkim} missing DKIM`);
  console.error(`  ${missingDmarc} missing DMARC`);
  console.error(`  ${policyNone} with DMARC policy=none`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
