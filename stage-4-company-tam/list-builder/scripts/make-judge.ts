#!/usr/bin/env tsx
/**
 * Assemble a lane judge prompt from prompts/_TEMPLATE.md + a lane spec, and
 * stamp its prompt_sha. Guarantees the four mandatory anti-false-negative
 * blocks are present (they caused real production misses when omitted).
 *
 * Usage:
 *   npx tsx make-judge.ts --spec=judge-spec.json --out=prompt.txt
 *
 * judge-spec.json:
 * {
 *   "icp": "one-liner",
 *   "lean": "lean YES when the identity language fits",   // or a stricter phrasing
 *   "thin_evidence_lean": "YES",                          // or "NO" for strict lanes
 *   "qualifies": ["bullet", ...],
 *   "disqualifies": ["bullet", ...]
 * }
 */
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { parseArgs } from "../../list-expander/scripts/lib";

const args = parseArgs();
if (!args.spec || !args.out) {
  console.error("Usage: npx tsx make-judge.ts --spec=judge-spec.json --out=prompt.txt\n" +
    "  judge-spec.json: { icp, lean?, thin_evidence_lean?, qualifies: [], disqualifies: [] }");
  process.exit(1);
}
const here = resolve(fileURLToPath(import.meta.url), "..");
const spec = JSON.parse(readFileSync(String(args.spec), "utf8"));
let t = readFileSync(join(here, "..", "prompts", "_TEMPLATE.md"), "utf8");
t = t.slice(t.indexOf("ICP:")); // drop the template's comment header, keep everything from ICP: on
t = t.replace("{{ICP_ONE_LINER}}", spec.icp)
     .replace("{{LEAN_DIRECTION}}", spec.lean ?? "lean YES when the identity language fits")
     .replace("{{THIN_EVIDENCE_LEAN}}", spec.thin_evidence_lean ?? "YES")
     .replace("{{QUALIFIES_BULLETS}}", (spec.qualifies ?? []).map((b: string) => `- ${b}`).join("\n"))
     .replace("{{DISQUALIFIES_BULLETS}}", (spec.disqualifies ?? []).map((b: string) => `- ${b}`).join("\n"));
for (const must of ["MANDATORY BLOCK 1", "MANDATORY BLOCK 2", "MANDATORY BLOCK 3", "MANDATORY BLOCK 4"]) {
  if (!t.includes(must)) { console.error(`assembled prompt missing ${must} — template corrupted`); process.exit(1); }
}
writeFileSync(String(args.out), t.trim() + "\n");
const sha = createHash("sha256").update(t.trim()).digest("hex").slice(0, 16);
console.log(`wrote ${args.out} (prompt_sha=${sha})`);
