#!/usr/bin/env tsx
/**
 * Phase 2 — Lookalike generation. Expands seed domains into candidate
 * lookalike companies via three sources, deduped by domain:
 *   - Prospeo company_lookalike (one call per seed domain) — REQUIRED lane
 *   - Exa findSimilar (per seed URL; returns homepage text in the same call)
 *     — OPTIONAL, skipped when EXA_API_KEY is unset
 *   - Parallel.ai entity-search (NL objective; watch for junk padding)
 *     — OPTIONAL, skipped when PARALLEL_AI_API_KEY is unset
 *
 * Usage:
 *   npx tsx lookalikes.ts --domains="a.com,b.com" --run=medical-groups \
 *     --objective="multi-site medical groups / multispecialty physician practices in the United States" \
 *     [--pages=3] [--exa-n=25] [--parallel-limit=150] [--skip-parallel] [--skip-exa] [--skip-prospeo] \
 *     [--country="United States #US"]
 *
 * Output: {run}/lookalikes-raw.csv (domain, name, source, description/homepage_excerpt)
 * These are CANDIDATES — qualify them (score-batch.ts or sub-agents) before Phase 3.
 */
import { join } from "path";
import {
  loadEnv, parseArgs, normDomain, outDir, writeCsv, httpJson, optionalEnv,
  prospeoSearch, prospeoCompanyRow, mapConcurrent, maybeHelp,
} from "./lib";

maybeHelp(`
lookalikes.ts — Phase 2: expand seed domains into lookalike candidates.

  npx tsx lookalikes.ts --domains="a.com,b.com" --run=<slug> \\
    --objective="<NL description of the COMPANY TYPE, not your product>" \\
    [--country="United States #US"] [--pages=3] [--exa-n=25] [--parallel-limit=150] \\
    [--skip-prospeo] [--skip-exa] [--skip-parallel]

Sources: Prospeo company_lookalike (REQUIRED: PROSPEO_API_KEY),
Exa findSimilar (OPTIONAL: EXA_API_KEY), Parallel.ai entity-search
(OPTIONAL: PARALLEL_AI_API_KEY). Lanes whose key is unset are skipped with a
log line, so the run still completes on Prospeo alone.

Output: <run>/lookalikes-raw.csv — these are CANDIDATES. Qualify them with
score-batch.ts before Phase 3.
`);

loadEnv();
const args = parseArgs();
const run = String(args.run ?? "default");
const dir = outDir(run);
const seeds = String(args.domains ?? "").split(",").map(normDomain).filter(Boolean);
if (!seeds.length) { console.error("Provide --domains=a.com,b.com"); process.exit(1); }
const objective = String(args.objective ?? "");
const pages = Number(args.pages ?? 3);            // prospeo lookalike pages per seed (25/page)
const exaN = Number(args["exa-n"] ?? 25);         // exa results per seed
const parallelLimit = Number(args["parallel-limit"] ?? 150);

type Candidate = { domain: string; name: string; source: string; seed?: string; industry?: string; text?: string; employee_count?: string; state?: string };
const candidates = new Map<string, Candidate>();
const seedSet = new Set(seeds);

function add(c: Candidate) {
  if (!c.domain || seedSet.has(c.domain)) return;
  const prev = candidates.get(c.domain);
  if (prev) prev.source = [...new Set([...prev.source.split("+"), c.source])].join("+");
  else candidates.set(c.domain, c);
}

async function prospeoLookalikes() {
  for (const seed of seeds) {
    const filters: Record<string, unknown> = { company_lookalike: { domain: seed } };
    if (args.country) filters.company_location_search = { include: [String(args.country)] };
    for (let p = 1; p <= pages; p++) {
      const r = await prospeoSearch("search-company", filters, p);
      if (r.error) { console.error(`  prospeo lookalike ${seed} p${p}: ${r.error_code} ${r.filter_error ?? ""}`); break; }
      if (!r.results.length) break;
      for (const item of r.results) {
        const row = prospeoCompanyRow(item);
        add({ domain: String(row.domain), name: String(row.name), source: "prospeo", seed, industry: String(row.industry), text: String(row.description), employee_count: String(row.employee_count ?? ""), state: String(row.state ?? "") });
      }
      if (p === 1) console.log(`  prospeo lookalike ${seed}: total_count=${r.total_count}`);
    }
  }
}

async function exaLookalikes() {
  const key = optionalEnv("EXA_API_KEY", "Exa findSimilar lane");
  if (!key) return;
  await mapConcurrent(seeds, 3, async (seed) => {
    const r = await httpJson("https://api.exa.ai/findSimilar", {
      headers: { "x-api-key": key },
      body: {
        url: `https://${seed}`,
        numResults: exaN,
        excludeSourceDomain: true,
        category: "company",
        contents: { text: { maxCharacters: 1500 } },
      },
    });
    for (const res of r.results ?? []) {
      const d = normDomain(res.url ?? "");
      add({ domain: d, name: res.title ?? d, source: "exa", seed, text: (res.text ?? "").replace(/\s+/g, " ").slice(0, 600) });
    }
    console.log(`  exa ${seed}: ${(r.results ?? []).length} results`);
  });
}

async function parallelLookalikes() {
  if (!objective) { console.log("  skipped: no --objective (Parallel.ai entity-search lane)"); return; }
  const key = optionalEnv("PARALLEL_AI_API_KEY", "Parallel.ai entity-search lane");
  if (!key) return;
  const r = await httpJson("https://api.parallel.ai/v1beta/findall/entity-search", {
    headers: { "x-api-key": key },
    body: { entity_type: "companies", objective, match_limit: parallelLimit },
    timeoutMs: 120_000,
  });
  const ents = r.entities ?? [];
  console.log(`  parallel: ${ents.length} entities (limit ${parallelLimit} — expect junk padding at tail; qualify before trusting)`);
  for (const e of ents) {
    // Parallel returns LinkedIn URLs, not company domains; keep name+li, resolve later if needed.
    const li = e.url ?? "";
    const d = normDomain(e.website ?? e.domain ?? "");
    add({
      domain: d || `li:${li.replace(/^https?:\/\/(www\.)?linkedin\.com\/company\//, "").replace(/\/$/, "")}`,
      name: e.name ?? "", source: "parallel", text: (e.description ?? "").slice(0, 400),
    });
  }
}

async function main() {
  console.log(`Lookalike generation for ${seeds.length} seeds → ${dir}`);
  if (!args["skip-prospeo"]) { console.log("Source 1/3: Prospeo company_lookalike"); await prospeoLookalikes(); }
  if (!args["skip-exa"]) { console.log("Source 2/3: Exa findSimilar"); await exaLookalikes(); }
  if (!args["skip-parallel"]) { console.log("Source 3/3: Parallel entity-search"); await parallelLookalikes(); }

  const rows = [...candidates.values()].map((c) => ({
    domain: c.domain, name: c.name, source: c.source, seed: c.seed ?? "", industry: c.industry ?? "", employee_count: c.employee_count ?? "", state: c.state ?? "", text_excerpt: c.text ?? "",
  }));
  writeCsv(join(dir, "lookalikes-raw.csv"), rows);
  const bySource = rows.reduce((m: Record<string, number>, r) => { for (const s of r.source.split("+")) m[s] = (m[s] ?? 0) + 1; return m; }, {});
  console.log(`\n${rows.length} unique candidates (${JSON.stringify(bySource)}) → ${join(dir, "lookalikes-raw.csv")}`);
  console.log("Next: qualify candidates (score-batch.ts with tuned prompt, or Claude sub-agents), write lookalikes-confirmed.csv");
}

main().catch((e) => { console.error(e); process.exit(1); });
