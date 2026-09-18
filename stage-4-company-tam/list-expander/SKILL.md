---
name: list-expander
description: Expand a hard-to-build niche list from ~10 known-good seed companies into a full qualified TAM. Seed fingerprinting (how do good-fit companies ACTUALLY show up in the company database's filters) → lookalike generation (Prospeo company_lookalike, Exa findSimilar, Parallel.ai entity search) → filter mining with a precision/volume scorecard → wide pull with auto-sharding → cheap-AI qualification → live-website verification → client transparency report. Use when a vertical list feels "too small" (medical groups, hedge funds, Medicare brokerages), when known good-fit companies don't show up in keyword searches, or when someone says "expand this list", "the TAM should be bigger", "find more companies like these".
---

# List Expander — seed companies → lookalikes → mined filters → qualified TAM

## The problem this solves

Niche lists come out tiny because we search databases with narrow explicit keywords, but real
good-fit companies (e.g. Atlantic Medical Group, Hackensack Meridian) often don't carry that
keyword in their database record. Instead of guessing keywords top-down, this skill works
bottom-up: take companies you KNOW fit, discover how the database actually tags them, expand via
lookalike engines, and only then derive the wide-net filters — with measured precision per filter
— before pulling and AI-qualifying at scale.

## Pipeline (5 phases)

All scripts live in `scripts/`, run with `npx tsx`, and are dependency-free (node ≥ 18 native
fetch). Every script takes `--help`. Keys load from the repo-root `.env` (see `.env.example`),
falling back to `~/.env`. Artifacts land in `~/output/list-expander/{run}/`.

```
Phase 1  fingerprint.ts    seeds → how each shows up in Prospeo + its live homepage
Phase 2  lookalikes.ts     seeds → candidates via Prospeo lookalike + Exa + Parallel
                           (qualify candidates → lookalikes-confirmed.csv)
Phase 3  mine-filters.ts   confirmed fits → candidate filters → scorecard (volume × precision)
Phase 4  pull.ts           winning filters → wide pull, auto-shard, dedup, exclusions
         score-batch.ts    scale AI qualification (gpt-5-nano by default)
         verify-website.ts second pass on QUALIFIED rows: live homepage fetch →
                           dead / suspended-parked / live; live sites re-judged on
                           their CURRENT content (catches stale-DB ghosts). Always run —
                           DB descriptions happily qualify dead companies otherwise.
Phase 5  contact-count.ts  verified-email TAM ceiling (free Prospeo count trick)
         report.ts         single-file HTML transparency report for the client
```

### Phase 0 — inputs
- ~10 seed companies known for sure to fit (domains).
- 1–2 sentence ICP description ("multi-site medical/specialty groups in the US, ≥$3M revenue").
- Optional: exclusion CSV (companies already in campaigns).

### Phase 1 — fingerprint the seeds
```bash
npx tsx scripts/fingerprint.ts --domains="a.com,b.com,..." --run=<slug>
```
Prints coverage (which seeds Prospeo is missing — **that gap IS the under-count story for the
client**), plus industry and keyword-tag frequency tables. Writes `fingerprint.json/csv`.

### Phase 2 — generate lookalikes
```bash
npx tsx scripts/lookalikes.ts --domains="<seeds>" --run=<slug> \
  --objective="<NL description of the COMPANY TYPE (not your product!)>" \
  --country="United States #US" --pages=3
```
- **Prospeo `company_lookalike`** (required lane): `{"domain": "<seed>"}` — one call per seed,
  single domain only (arrays 400). Composable with location/headcount/keyword filters.
  One large health system seed returned 5,727 lookalikes.
- **Exa findSimilar** (optional lane): content similarity, and it returns homepage text in the
  same call — free evidence for qualification.
- **Parallel.ai entity-search** (optional lane): ~$0.005/req, pads to `match_limit` with junk —
  always qualify before trusting; returns LinkedIn URLs, not domains.

Optional lanes whose key is unset are **skipped with a log line**, so the run still completes on
Prospeo alone. Then qualify candidates (Claude sub-agents for a small set, or `score-batch.ts`
with a draft prompt) → write `lookalikes-confirmed.csv`. Target 50–150 confirmed.

### ⚠️ EXHAUSTIVE-SWEEP DEFAULT
Phase 3's scorecard is for TRANSPARENCY, not selection. The pull in Phase 4 must include:
(a) EVERY industry carried by ≥1 confirmed fit — whole industry, headcount band + geo only, no
keyword narrowing; (b) EVERY discriminative keyword from confirmed fits across ALL industries.
Score everything with the cheap model. Only band + geography are legal pre-filters. Snowball
until net-new drops under 2–3%. Never trim the sweep to save AI cost — recall is the product.
Pull keywords unless they are stopword-grade.

### Phase 3 — mine + score filters
```bash
npx tsx scripts/mine-filters.ts --csv=<confirmed.csv> --run=<slug> --propose --country="United States #US"
# Claude reviews/edits {run}/candidates.json: prune generic n-grams, add synonym keywords
# (the "every medical group contains 'group'" trap — kill terms that are frequent but not discriminative)
npx tsx scripts/mine-filters.ts --run=<slug> --scorecard
# score the 25-company samples:
for f in ~/output/list-expander/<slug>/samples/*.csv; do
  npx tsx scripts/score-batch.ts --csv=$f --prompt-file=<icp-prompt.txt> --out=${f%.csv}-scored.csv; done
mkdir -p ~/output/list-expander/<slug>/samples-scored && mv ~/output/list-expander/<slug>/samples/*-scored.csv $_
npx tsx scripts/mine-filters.ts --run=<slug> --scorecard --precision-from=~/output/list-expander/<slug>/samples-scored
```
`--propose` fingerprints each confirmed company against Prospeo **and fetches its live homepage**,
then mines 2–3-grams across that combined text. The homepage is the evidence source that matters:
it says what a company calls itself *today*, which is exactly what a keyword filter has to match.
Pass `--no-scrape` to mine from Prospeo descriptions only (faster, thinner).

Output: `filter-scorecard.csv` — per filter: Prospeo count, sampled precision, estimated
qualified yield. **Review with the user before Phase 4.**

### Phase 4 — wide pull + scale qualification
Tune the qualification prompt FIRST via `/icp-prompt-builder` (interactive, 10-company batches,
2 clean rounds to converge).
```bash
# Write {run}/winners.json (filter_sets + base_filters — format documented in pull.ts header)
npx tsx scripts/pull.ts --run=<slug> --test          # 2 pages/set sanity check FIRST
npx tsx scripts/pull.ts --run=<slug> --exclude=<existing.csv>
npx tsx scripts/score-batch.ts --csv=<run>/pull-all.csv --prompt-file=<icp-prompt.txt> --scrape --concurrency=8
npx tsx scripts/verify-website.ts --run=<slug> --prompt-file=<icp-prompt.txt> --concurrency=40
```
Verify the first test output shows real successes before the full run. Any filter set whose
`total_count` exceeds 24k is auto-sharded (country → 51 states → headcount-band bisection) so the
tail is never truncated.

### Phase 5 — TAM ceiling + report
```bash
npx tsx scripts/contact-count.ts --csv=<qualified.csv> --run=<slug> \
  --titles="COO,VP Operations,..." --seniorities="C-Suite,Vice President,Head,Director"
npx tsx scripts/report.ts --run=<slug> --title="<Vertical> — TAM Expansion"
open ~/output/list-expander/<slug>/report.html
```

## Requirements / env

Put these in the repo-root `.env` (copy `.env.example`), or `~/.env`.

**REQUIRED**
| Var | What for | Sign up |
|---|---|---|
| `PROSPEO_API_KEY` | Every phase: company search, lookalikes, counts | https://prospeo.io/ → dashboard → API (copy the X-KEY) |
| `OPENAI_API_KEY` | AI qualification in `score-batch.ts` + `verify-website.ts` | https://platform.openai.com/api-keys |

**OPTIONAL** (each is one lane; unset = that lane logs `skipped: <VAR> not set` and the run continues)
| Var | What for | Sign up |
|---|---|---|
| `EXA_API_KEY` | Exa `findSimilar` lookalike lane in `lookalikes.ts` | https://exa.ai/ |
| `PARALLEL_AI_API_KEY` | Parallel.ai entity-search lookalike lane in `lookalikes.ts` | https://parallel.ai/ |
| `OPENAI_API_KEY_NANO` | A separate cheap-model key; used in preference to `OPENAI_API_KEY` when set | https://platform.openai.com/api-keys |
| `OPENAI_ICP_MODEL` | Override the qualification model (default `gpt-5-nano`) | — |
| `PROSPEO_MIN_INTERVAL_MS` | Slow Prospeo pacing below the built-in 450ms floor. Can only make it **slower** — values under 450 are clamped | — |

No database is required. Every artifact is a file under `~/output/list-expander/{run}/`.

## Verified API facts

| Filter | Syntax | Notes |
|---|---|---|
| `company_lookalike` | `{"domain": "x.com"}` or `{"icp_text": "..."}` | single domain only; `icp_text` describing the *product* surfaces vendors — describe the *company* |
| `company_keywords` | `{"include": [...], "exclude": [...]}` | multi-word phrases OK; combine with `company_industry` for precision |
| `company_key_customers` | `{"include": [...]}` | matches by who their customers are |
| `company_headcount_custom` | `{"min": N, "max": N}` | use this, not `headcount_range` (enum format unverified) |
| `company_products_services`, `company_icp` | ❌ broken/unusable via API | use `company_keywords` / `company_lookalike.icp_text` instead |

**Prospeo pacing (measured):** `PROSPEO_MIN_INTERVAL_MS=200` (5 req/s) trips "Rate limit exceeded"
after ~1,000 requests; **450 ms (~2.2 req/s) ran 1,550+ requests clean**. The account limit is
GLOBAL, so `lib.ts` paces every process through a shared slot file
(`~/.cache/prospeo-lock/`) with a 450 ms floor, backs off 45 s on a rate-limit, and makes that
penalty visible to every other running process. Identical request+page re-runs within 30 days are
FREE (`free:true`) — re-pulling after a partial failure costs nothing.

**Prospeo count trick:** a page-1 call's `pagination.total_count` sizes any filter cheaply; add
`person_contact_details:{email:["VERIFIED"]}` on `/search-person` for the verified-email ceiling.
Seniority enum: `Founder/Owner, C-Suite, Partner, Vice President, Head, Director, Manager, Senior,
Entry, Intern` — never "VP", never "President".

## Related skills
- `/icp-prompt-builder` — tune the qualification prompt before Phase 4 (the score-batch script it
  refers to lives HERE: `scripts/score-batch.ts`)
- `/prospeo-search-api` — full Prospeo filter reference
- `/prospeo-full-export` — title-first paginated lead export once you have the company list
- `/blitz-list-builder` — domain-first contact discovery on the qualified companies
- `/disco-like` — a 4th lookalike source (seed domains or NL ICP text)
- `/list-quality-scorecard` — grade the final CSV before it goes anywhere near a campaign
