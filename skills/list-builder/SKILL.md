---
name: list-builder
description: META skill — build the largest possible qualified lead list for any request, end to end. Orchestrates discovery (Prospeo + GetLeads + Blitz + Google Maps + lookalike snowball from /list-expander), AI qualification with live-website verify, uncapped contact pull (GetLeads → Blitz → Prospeo), and provider emails (GetLeads/Blitz/Prospeo) validated with MillionVerifier before sending. Use for any "build me a list", "get me leads for X", "find everyone who...", client list request, or campaign list build. Starts with a 7-line intake brief; outputs to Postgres, Google Sheet, and/or CSV (asks which).
---

# List Builder — the meta list-building process

## ⚡ OPERATE VIA THE RUNBOOK

The manual phase-by-phase flow below still documents the concepts, but the OPERATIONAL
path is now three one-command scripts — see **RUNBOOK.md in this skill directory** for
the decision table and failure playbook. In short:

```bash
npx tsx scripts/make-judge.ts --spec=judge-spec.json --out=prompt.txt   # judge (mandatory blocks)
npx tsx scripts/run-lane.ts  --config=lane.json                         # full lane, resumable
npx tsx scripts/snowball.ts  --config=lane.json                         # sweep until dry
npx tsx scripts/contacts.ts  --config=lane.json                         # contacts + emails after approval
```
Re-running the same command resumes after ANY failure. `summary.md` line 1 = READY / NOT READY
with the next command. Cross-run dedup via the OPTIONAL `list_builder_judged_domains`
Postgres registry (WAL-first; `scripts/registry.ts`; DDL in `references/registry-schema.sql`;
leave `LIST_REGISTRY_DB_URL` unset and it degrades to per-run WAL dedup). Prospeo pacing is
globally rate-limited across processes (lib.ts slot reservation — never tune it).


One entry point for every list request. This skill owns the PROCESS and delegates to
tool skills that own the provider gotchas. Read the referenced skill whenever you touch
its provider.

| Layer | Delegate |
|---|---|
| Company discovery + qualification + snowball | `/list-expander` (scripts in its `scripts/`) |
| Prospeo filters/syntax | `/prospeo-search-api` |
| Blitz domain→people | `/blitz-list-builder` (`scripts/find-contacts.ts`) |
| GetLeads counts/exports | `scripts/getleads-client.ts` (counts are free) — optional, skipped without a key |
| Email validation | provider emails from GetLeads/Blitz/Prospeo → `leads-final.csv`; validate with MillionVerifier (`/cold-email-starter-kit`) before upload |
| Judge tuning | `/icp-prompt-builder` |
| Local/SMB discovery | `/google-maps-list-builder` |
| List QA before delivery | `/list-quality-scorecard` |

Scripts in THIS skill's `scripts/`: `contacts-merge.ts` (normalize/dedup contact pulls, keeps
every raw provider field), `enrich-domains.ts` (batch Prospeo enrichment for any domain list — headcount/revenue/state/
phone; strips subdomains), `classify-batch.ts` (multi-segment nano classifier — one pass
assigns each company to one of N segments; use for industry sweeps that feed several lanes).

**Observability + multi-lane helpers (2026-07-14):**
- `fleet.ts` — read-only status board over `~/output/list-builder/lanes/*`: one row per lane
  (current stage, status, rows in newest stream, minutes idle, snowball in flight, READY?).
  Zero side effects — safe to run against live runs. `npx tsx scripts/fleet.ts` (add `--json`).
- `multi-lane-classify.ts` — when several lanes for one client draw from OVERLAPPING pulls,
  union their MERGE candidate pools by domain and label every unique company in ONE nano pass
  (labels = lane names, prompt built from each lane's judge ICP one-liner). Writes per-lane
  `<client>-<lane>-candidates.csv` for consumption via `extra_candidates`. Additive — does not
  change run-lane's per-lane flow. `npx tsx scripts/multi-lane-classify.ts --lanes=a.json,b.json`.

## Requirements / env

**Prerequisites:** Node ≥ 18 with `npx tsx` (`npm i -g tsx`); `python3` + `pip install gspread` only if you use the Google Sheet destination; `psql` on PATH only if you set `LIST_REGISTRY_DB_URL`. Copy the repo-root `.env.example` to `.env` and fill in the keys below — scripts walk up from `skills/list-builder/scripts/` to find it.

Put these in a `.env` at the repo root (or `~/.env` — `loadEnv()` reads both) or export them.

**REQUIRED**

| Var | What for | Get one |
|---|---|---|
| `PROSPEO_API_KEY` | company + people search, the primary discovery source | sign up at https://prospeo.io |
| `OPENAI_API_KEY` | the GPT-5-nano judge that scores every candidate | sign up at https://platform.openai.com |

**OPTIONAL** — each of these degrades gracefully: the script logs a skip line and continues.

| Var | What for | Without it |
|---|---|---|
| `OPENAI_API_KEY_NANO` | a separate key/project for nano scoring | falls back to `OPENAI_API_KEY` |
| `OPENAI_ICP_MODEL` | override the judge model (default `gpt-5-nano`) | uses the default |
| `GETLEADS_API_KEY` | free contact counts + exports, first stop in Phase 4 (sign up at https://getleads.io) | contacts.ts marks GETLEADS `skipped` and every domain falls through to Blitz/Prospeo |
| `BLITZ_API_KEY` | domain→people fallback via `/blitz-list-builder` (see that skill for signup) | BLITZ stage skips, Prospeo covers those domains |
| `EXA_API_KEY`, `PARALLEL_AI_API_KEY` | lookalike / entity discovery inside `/list-expander` Phase 2 (sign up at https://exa.ai, https://parallel.ai) | those sub-sources are skipped, seeds + filters still run |
| `LIST_REGISTRY_DB_URL` | Postgres URL for cross-run dedup (DDL: `references/registry-schema.sql`) | WAL-only dedup: a run never re-judges itself, but earlier runs are not deduped |
| `MILLIONVERIFIER_API_KEY` | validate `leads-final.csv` before upload (https://millionverifier.com) | OPTIONAL for the build; REQUIRED before you send |
| `GOOGLE_APPLICATION_CREDENTIALS` | service-account JSON for the Google Sheet destination (`push-sheet.py`) | omit `destination.sheet_id` in lane.json for a CSV-only lane |

`psql` must be on PATH for the optional registry. Nothing else is required.

### Emails

GetLeads, Blitz and Prospeo each return an email + verification status per person.
`contacts.ts` writes every contact that has one to `leads-final.csv` with an
`email_status` column (`verified` when the provider says so, else `unverified`). Before
you upload, run the whole file through MillionVerifier (see `/cold-email-starter-kit`) and
keep only `ok`/valid results — never catch-all, never unknown.

## Hard rules

1. **ALL matching titles at ALL companies — never cap contacts per company.**
2. **Emails: validate every address before sending.** A provider status of
   verified/VALID is a hint, not send-ready; MillionVerifier `ok` is the gate.
3. Keep only strict valid results. Never catch-all/unknown.
4. Save the MAXIMUM data providers return — every contact row carries `raw_json`;
   database destinations get a `raw_json JSONB` column.
5. A live Google Sheet progress view is the default whenever you have sheet credentials
   (`scripts/push-sheet.py`, `destination.sheet_id` in lane.json) — stream verified rows
   as they land. Without credentials the lane is CSV-only; everything else is identical.

## Phase 0 — Intake (ask ALL of this up front, one message)

1. **Seeds**: ~10 known-good companies (client's customers are best). If none given, derive candidates and confirm.
2. **ICP one-liner + explicit disqualifiers** (what looks close but is NOT a fit).
3. **Bands**: employee range, revenue floor, founded, etc. — applied AT PULL TIME.
4. **Geography**.
5. **Target titles/seniorities** (no cap on matches).
6. **Destination**: database table / Google Sheet / local CSV — ask; any combo.
7. **Exclusions**: any CSV/table of domains to skip (optional; do NOT auto-dedupe against your sending platform — that is handled at upload time).

## THE EXHAUSTIVE-SWEEP LAW (this is the point of the skill)

Recall is sacred; precision is nano's job. **"I don't care how much money we spend on AI
to clean these things up. I want the largest list we can possibly grab."**

1. **Industries:** if even ONE confirmed-fit company carries an industry tag, pull EVERY
   company in that industry (within band + geography) and nano-score all of them. A hedge
   fund tagged "Financial Services" means you pull all of Financial Services in scope.
   Never pre-filter an industry pull by keywords.
2. **Keywords:** every discriminative keyword/phrase found on confirmed fits gets pulled
   across ALL industries (you have no clue what industries a "SaaS"-tagged company sits
   in). Multi-word phrases beat their parts: "medical" bad, "group" bad, "medical group"
   good. Drop only stopword-grade single tokens; when unsure, pull it and let nano sort.
3. **The ONLY pre-filters allowed at pull time are the client's hard band (headcount/
   revenue) and geography.** Everything else is decided by the GPT-5 Nano judge reading
   the company's description/homepage.
4. **Score EVERYTHING pulled.** Never sample, never cap, never skip scoring to save money
   — nano costs ~$1-3 per 10k companies; a missed segment costs a client.
5. **Snowball:** every nano-confirmed fit enlarges the seed set → re-derive industries +
   keywords from the LARGER set → sweep the delta → repeat until a round adds <2-3%
   net-new qualified companies. That convergence is the only valid reason to stop.
6. The filter-precision scorecard is REPORTING (transparency for the client), never a
   gate that excludes a filter from being pulled.

Corollary: hand-picking a few keywords "for speed" is a bug, not a shortcut — an
Investment Management industry sweep surfaced several large funds that keyword search
missed entirely.

**Operating rules:**
- Industry trigger is LITERAL (1 confirmed fit = sweep the industry). Mega-industries
  (>100k companies in scope) go through the SAME Prospeo `/search-company` pull:
  `pull.ts` auto-shards any filter whose page-1 `total_count` exceeds 24k — country-wide
  into 50 states + DC, then a single state by headcount-band bisection — so Prospeo's
  ~25k-per-filter tail truncation never silently drops the remainder. `snowball.ts` logs
  `[mega] <industry>: N in scope` when it hands one of these to the sharder.
- Keywords: pull unless stopword-grade. Multi-word always; specific single tokens
  ("SaaS", "REIT", "Medicare") yes; generic ("group", "services") no; unsure → pull.
- Cost gate: run without asking below ~500k total sweep; above that, show the operator
  the count/cost breakdown first.

## Phase 1 — Discovery (cast every net in parallel)

Run ALL applicable sources, dedup by domain (`normDomain` in list-expander `lib.ts`):
- **Seed-driven core** (when seeds exist — almost always): `/list-expander` Phases 1–3
  (fingerprint → lookalikes → filter mining with precision×volume scorecard).
- **Prospeo** `/search-company` with the winning filters (450ms pacing; re-pulls free 30d).
- **GetLeads** `count_contacts`/`search_contacts` with `company_description` + technographic
  filters (free counts; a third corpus).
- **Blitz** `POST /v2/search/companies` (free) when company-first.
- **Google Maps** when local/SMB — `/google-maps-list-builder` (live scrape by category ×
  metro). Category names are ground truth for local trades (e.g. 'Fence contractor'), so
  sweep the category rather than a keyword guess. If you keep a bulk Maps export on disk,
  grep it by category first (free) and feed the result in as `extra_candidates`.
- **Parallel entity-search / Exa findSimilar / DiscoLike** — already inside list-expander
  Phase 2 (see `/disco-like`). For local-service TAMs, ALSO run a Parallel per-metro fan-out
  (one objective per metro, match_limit ~40, ~$0.005/call, then keyword-filter the output —
  roughly 75% is padding). Parallel returns NO domains: resolve them by company-name search
  in Prospeo `/search-company`, then Exa search (needs credits).

**External-source CSVs feed the lane via `extra_candidates` in lane.json**: absolute CSV
paths with a `domain` column; rows merge into MERGE with normDomain + registry dedup +
emp-band-when-known. This is how Maps pulls, Parallel fan-outs, and ad-hoc keyword pulls
enter the judged pipeline.

**Post-lane EXPANSION pass for local trades** (measured +56% on top of a READY lane):
after a lane is READY, sweep LIVE sources and run the delta through judge→verify→registry:
1. **Live Maps by QUERY** (not category) — see `/google-maps-list-builder`; ~350 cities ×
   trade queries, keep the `website` field; ~70% net-new versus category-based candidates.
2. **Yellow Pages** — Apify `trudax/yellow-pages-us-scraper`, ONE run with startUrls =
   `yellowpages.com/search?search_terms=X&geo_location_terms=<STATE>` × 50 states. Spam-dense
   (36% aggregator/doorway junk, 25% judge-pass) — never skip judge+verify. `automation-lab`
   actor returns NULL websites.
3. **Yelp** — Apify `memo23/yelp-scraper` (startUrls = yelp search URLs, fetchBusinessDetails)
   — ~90% website fill + `businessOwnerName` (owner first names → contacts phase); shallow yield.
   Both Apify actors are optional: skip them and the lane still completes.
Delta pipeline: dedup vs lane WAL → `score-batch.ts` → `verify-website.ts`
(`--run=__abs__<dir>`, stream files must be named `pull-batch*-scored.csv.stream.csv`) →
`walAppend` + `registry.ts sync` → append tab to the destination sheet.

## Phase 2 — Qualify + verify (greedy discovery is safe because of this layer)

- Tune the judge once via `/icp-prompt-builder` (10-company rounds until 2 clean).
- Scale-score with `list-expander/scripts/score-batch.ts` (GPT-5 Nano, `OPENAI_API_KEY_NANO`
  or `OPENAI_API_KEY`,
  concurrency 60, `--scrape` for missing descriptions; streams to `.stream.csv`).
- **Always** run `list-expander/scripts/verify-website.ts` — ~10% of DB-qualified companies
  are dead/parked ghosts; live homepage re-judge catches stale-DB false positives.

## Phase 3 — Snowball until dry (the "largest possible list" guarantee)

Feed each round's confirmed fits back as new seeds → new lookalikes → new candidate
filters → pull the delta → qualify. **Stop when a round adds <2-3% net-new qualified
companies.** Record rounds + net-new counts — the convergence curve goes in the client
report as proof of full-market coverage.

## Phase 4 — Contacts (uncapped, cost-ordered)

For every qualified company, pull ALL people matching target titles:
1. **GetLeads** (free counts/exports, optional key): `search_contacts`/`export_contacts`
   filtered by `domains` (batch ≤500), `job_titles`/`seniority`. Download export CSV.
   No key ⇒ the stage is skipped and every domain falls to Blitz/Prospeo.
2. **Blitz** (optional key): `/blitz-list-builder` `scripts/find-contacts.ts` for domains
   GetLeads covered thinly.
3. **Prospeo** `/search-person` with `company.websites {include:[...]}` (LAST — most expensive;
   strip subdomains or the whole batch 400s).

Merge + dedup: `npx tsx scripts/contacts-merge.ts --run=<slug> --csv=<file>:<provider> ...`
(dedupes by linkedin_url, else domain+first+last; keeps every original column in `raw_json`).

## Phase 5 — Emails

`contacts.ts` step 6 writes `leads-final.csv` (every merged contact with a provider email,
`email_status` = verified|unverified). Then validate:

```bash
# MillionVerifier bulk validation — see /cold-email-starter-kit for the script and key setup
# keep result == "ok" only; drop catch_all / unknown / invalid
```

## Phase 6 — Deliver

- Chosen destination(s): a per-client database table (`raw_json JSONB`; RLS on if you use
  Supabase) and/or Sheet and/or CSV.
- The sheet, if configured, is already populated from Phase 2 onward.
- Transparency report: `list-expander/scripts/report.ts` + snowball convergence curve +
  contact/email funnel. Verified-email ceiling via `contact-count.ts` (free) BEFORE Phase 4
  so the client sees the ceiling early.

## Automation hardening (2026-07-14)

The orchestrators now self-protect against the failure classes that caused silent misses:
- **Auto-shard >24k Prospeo filters** (`pull.ts`): any single filter whose page-1 total
  exceeds 24k is auto-sharded — country-wide → 50 states + DC, then a single state → headcount
  band bisection (recursively), merged by domain. Logs `sharded <label> into N sub-pulls`.
  Inherited by run-lane PULL and every snowball pull; no more lost tails.
- **PRECHECK config validation** (`run-lane.ts`): probes Prospeo once with the emp band and once
  with ALL industries in one call, and rejects `emp_max>100000` (unless a no-band lane). A bad
  band/industry now fails PRECHECK with the exact offending field and BLOCKS pull — no wasted run.
- **Legacy industry map** (`list-expander/lib.ts` `LEGACY_INDUSTRY_MAP` / `mapIndustry`): snowball
  translates legacy LinkedIn tags (Manufacturing → General Manufacturing, etc. — all probed valid)
  to the modern Prospeo enum before sweeping, so a legacy tag sweeps its modern equivalent instead
  of erroring the whole set. Add only names verified valid via a free count probe.
- **snowball rounds** now run the same REJECT_AUDIT rescue as run-lane on each round's rejects,
  check child exit status + output length (throw a resume message instead of silently continuing),
  use a **two-phase swept-ledger** (a filter is "done" only after a `judged` entry lands — a crash
  between pull and judge re-pulls, free within 30d; old single-phase ledgers still honored), and
  **stream dedup** round rows straight to `snowball-rN.csv` (flat memory).
- **score-batch straggler deadline + retry**: each row's classify (incl. scrape) has a 120s hard
  timeout (marks `scored=false reason=timeout`, no more 99.99%-done hangs), and one automatic retry
  pass re-scores all failures before reporting the final count.

## Ops notes

- Run a 50–100-row test before every full run; read the first progress output and confirm
  real successes; surface failures immediately rather than at the end.
- Prospeo pacing is 450ms and globally enforced across processes. MillionVerifier 403s the
  default Python/Node User-Agent — send a browser UA.
- Reference funnel from a real pilot: 10 seeds → 30,405 pulled → 11,198 qualified →
  9,247 live-verified → 1,727 in-band → ~30,755 verified-email ceiling.
