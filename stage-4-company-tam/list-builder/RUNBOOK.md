# List-Builder Runbook (for the operating model — read this, run commands, don't improvise)

Every command below is complete. Re-running the SAME command after any failure resumes
safely. Artifacts live in `~/output/list-builder/lanes/<client>-<lane>/`; the file to read
after any run is `summary.md` — its FIRST LINE is `# READY` or `# NOT READY` with the next
command embedded.

## Decision table — you have X, run Y

| You have | Run |
|---|---|
| A list request (any) | 1. Intake (below) → 2. `make-judge.ts` → 3. `run-lane.ts` |
| A lane that finished READY and you want it BIGGER | `snowball.ts --config=<lane.json>` then the run-lane command it prints |
| A READY lane approved for outreach | `contacts.ts --config=<lane.json>` |
| A failed/interrupted run | THE SAME `run-lane.ts` command again. That's the whole recovery. |
| A judge that seems to over-reject | nothing — REJECT_AUDIT auto-rescues >15% disagreement; check `reject-audit.csv` (snowball rounds write `reject-audit-rN.csv`) |
| "what's the status of all my lanes?" | `npx tsx scripts/fleet.ts` — read-only board (stage/rows/idle/READY), safe on live runs |
| Several lanes over OVERLAPPING pulls | `multi-lane-classify.ts --lanes=a.json,b.json,...` → per-lane candidate CSVs to use as `extra_candidates` (one nano pass, no re-judging the same company N times) |

## 1. Intake → lane.json
Collect: client_slug, lane name, ICP one-liner + disqualifiers, emp band, states (or US),
industries + keywords carried by known-good companies, ~10 seed domains, thresholds.
Write `lane.json` (full shape documented at the top of `scripts/run-lane.ts`).

## 2. Judge
```bash
npx tsx scripts/make-judge.ts --spec=judge-spec.json --out=<prompt.txt>
```
NEVER write a judge prompt by hand — the template's four MANDATORY blocks prevent the
false-negative classes that cost real rescues in production (unstated AUM, unstated
geography, sparse fund websites, thin-evidence rejections).

## 3. Build the lane
```bash
npx tsx scripts/run-lane.ts --config=<lane.json>
```
Stages: PRECHECK → LOOKALIKES → PULL → MERGE → SCORE → REJECT_AUDIT → VERIFY → ENRICH →
FINALIZE → COUNT → PUSH → REPORT. All resumable; completion decided from artifacts.

## 4. Maximize (the exhaustive-sweep law, automated)
```bash
npx tsx scripts/snowball.ts --config=<lane.json>
```
Sweeps every industry the confirmed fits carry, rounds until <3% / <25 net-new. Then run
the `run-lane.ts` command it prints (refinalize + recount).

## 5. Contacts + emails (after client approves the company list)
```bash
npx tsx scripts/contacts.ts --config=<lane.json>
```
GetLeads → Blitz → Prospeo (uncapped, all titles) → EVERY contact through the email
finder (`leads-final.csv` = Final Email only; provider emails are never send-ready).
contacts.ts ends by writing `leads-final.csv` from provider emails; validate it with
MillionVerifier before uploading (see SKILL.md "Emails").

## Failure playbook

| summary.md / console says | Do |
|---|---|
| `NOT READY: <stage> is failed` | Re-run the same run-lane command. If it fails twice with the same permanent error (400-class), the error text names the bad filter/prompt — fix lane.json, re-run with `--accept-config-change`. |
| `PRECHECK failed: config: emp_max=… exceeds …` / `invalid industry in […]` | PRECHECK now validates the emp band + all industries up front and BLOCKS pull. Fix the named field in lane.json (see `LEGACY_INDUSTRY_MAP` in list-expander/scripts/lib.ts for legacy→modern industry names), re-run. |
| snowball `score-batch exited N (x/y scored)` / `verify-website exited N` | A round child died mid-way. Re-run the SAME snowball command — the two-phase ledger re-pulls only unjudged filters (free within 30d) and score-batch resumes from its stream. |
| `lane already running (pid N)` | Someone/something is running it. Do nothing. Only `--steal-lock` if you verified pid N is dead. |
| `lane.json changed since this run started` | You edited the config. Re-run with `--accept-config-change` (re-scores) or use a fresh `--run-dir`. |
| `rate-limited` / penalty messages | Do nothing. The shared limiter waits it out; every process honors the penalty file. NEVER lower `PROSPEO_MIN_INTERVAL_MS` (it's clamped anyway). |
| watchdog killed a stage | Normal — a child stalled; re-run the same command, it resumes from the stream files. |
| `registry: LIST_REGISTRY_DB_URL not set` / `registry DB unreachable — WAL-ONLY` | Run continues safely; cross-run dedup is off. Set the URL (DDL: `references/registry-schema.sql`) and run `npx tsx scripts/registry.ts sync <run-dir>` afterwards. |
| `state.json is corrupt` | `mv state.json state.json.bad` and re-run (artifacts drive re-derivation). |
| PUSH refuses (`NOT READY`) | Read the reasons; they are threshold failures. Never use `--push-anyway-i-checked` without a human decision. |

## NEVER do
- NEVER cap contacts per company, skip the email finder for "already have an email", or
  send GetLeads/Blitz/Prospeo emails directly.
- NEVER crank `PROSPEO_MIN_INTERVAL_MS` down or run Prospeo calls outside lib.ts.
- NEVER move/rename files inside a run dir, or hand-edit stream CSVs.
- NEVER hand-write a judge prompt without the template's mandatory blocks.
- NEVER treat a lane with a failed stage as deliverable — `# READY` is the only green light.
- NEVER trim a sweep to save nano cost. Recall is the product (~$1-3 per 10k companies).
