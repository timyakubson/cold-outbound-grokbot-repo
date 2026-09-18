---
name: list-quality-scorecard
description: Pre-send quality scorecard for any lead list. Grades duplicate rate, title diversity, bad-title patterns, catch-all domain density, ICP fit, email verification coverage. Outputs a letter grade + action items BEFORE you send. Catches bad lists before they burn inboxes. Run after email enrichment, before Smartlead upload.
---

# List Quality Scorecard

A CSV of 5,000 leads is not the same as a good list of 5,000 leads. This skill grades your list across 8 dimensions BEFORE you send, catching preventable waste.

## Why this exists

The three campaign failure modes cold email runners hit most:

1. **Bad list** — the copy doesn't matter when you're emailing the wrong people
2. **Unverified emails** — bounces burn domain reputation
3. **ICP drift** — you think you're targeting VPs, but the list is mostly Managers

Each of these is catchable before you send, in 5 minutes, for free.

## Inputs

A CSV with at minimum these columns:
- `email` — the primary email
- `first_name`, `last_name`
- `job_title` OR `title`
- `company_name` OR `company`
- `company_domain` (optional, derived from email if missing)
- `company_industry` (optional, used for ICP fit scoring)
- `company_headcount` (optional, used for ICP fit scoring)

## Output

A markdown scorecard with:
- **Letter grade** (A+ to F)
- **8 dimension scores** (each 0-100)
- **Top 5 issues to fix**
- **Pre-send checklist**

## Usage

```bash
npx tsx scripts/score-list.ts --list=leads.csv --icp-file=client-profile.yaml --out=scorecard.md
```

Optional `--icp-file` lets the scorecard compare your list against your declared ICP filters (from `/icp-onboarding`).

## The 8 dimensions

### 1. Email verification coverage (critical)

- **What:** % of emails validated via MillionVerifier or equivalent
- **Rule:** 100% of a cold list must be verified before sending. Unverified emails = bounces = dead domains.
- **Score:** 100 if all verified, 0 if <50% verified

### 2. Duplicate email rate

- **What:** % of duplicate emails in the list
- **Rule:** <1% acceptable, >5% is a problem
- **Score:** 100 at 0%, drops linearly

### 3. Duplicate domain rate

- **What:** max # of leads from any single domain
- **Rule:** 1-2 leads per domain ideal. 5+ suggests you're over-indexing on one company.
- **Score:** 100 if avg <2 per domain, 60 if avg 2-5, 30 if >5

### 4. Title relevance

- **What:** % of titles matching your ICP's job title list
- **Rule:** Exact-match + synonym list. If 40% of your "VP Sales" list is actually "Sales Manager", you have drift.
- **Score:** 100 if ≥80% match, 50 if 40-80%, 0 if <40%

### 5. Bad-title detection

- **What:** % of titles matching known-bad patterns
- **Bad patterns:** `intern`, `assistant`, `coordinator`, `student`, `part-time`, `retired`, non-English titles when targeting US
- **Rule:** <2% is normal, >10% means your Prospeo filter is too loose
- **Score:** 100 if <2%, drops sharply after

### 6. Catch-all domain density

- **What:** % of emails on catch-all domains (e.g., `info@`, `contact@`, `hello@`)
- **Rule:** <5% acceptable for B2B outbound
- **Score:** 100 if <5%, 50 at 5-15%, 0 if >15%

### 7. ICP fit

- **What:** % of leads matching your `client-profile.yaml` filters on industry + headcount
- **Requires:** `--icp-file` passed
- **Rule:** 80%+ match, 100 if exact

### 8. Name quality

- **What:** % with both first_name AND last_name populated AND looking human
- **Checks:** Not all-caps, not fake names ("Admin", "Info"), not email-as-name
- **Rule:** 95%+ acceptable
- **Score:** 100 if 95%+, drops linearly

## Letter grade mapping

Weighted average across 8 dimensions (verification and ICP fit weighted 2x):

| Average | Grade | Action |
|---|---|---|
| 90-100 | A+ / A | Ship it |
| 80-89 | B | Minor fixes, then ship |
| 70-79 | C | Fix top 3 issues first |
| 60-69 | D | Serious cleanup required |
| <60 | F | Don't send. Rebuild the list. |

## Example output

```
=== List Quality Scorecard ===

File: leads.csv (2,147 rows)
Grade: B (84/100)

Dimensions:
1. Email verification:    100/100  (100% verified, good)
2. Duplicate emails:       95/100  (1.1% duplicates — trim before send)
3. Duplicate domains:      78/100  (avg 2.4 per domain — some over-concentration)
4. Title relevance:        82/100  (85% titles match "VP Sales" / "Head of Sales")
5. Bad-title detection:    92/100  (3% Coordinators slipped in — filter)
6. Catch-all density:      80/100  (8% catch-all — consider dropping)
7. ICP fit:                88/100  (88% match declared industry filter)
8. Name quality:           97/100  (good)

Top 5 issues to fix:
1. 23 emails are duplicates (1.1%) — deduplicate before upload
2. 64 leads are on catch-all addresses (3.0%) — drop or deprioritize
3. 64 Coordinators in the list — filter by seniority ≥ Manager
4. 147 leads cluster on 12 domains (>5 each) — cap at 3 per domain
5. 258 leads outside declared industry filter (12%) — filter by company_industry

Pre-send checklist:
[ ] Deduplicate by email
[ ] Drop catch-all if >5% (reduces bounce rate)
[ ] Filter out bad titles
[ ] Cap per-domain concentration
[ ] Re-run verifier if list shrunk >10%
```

## When to use

- AFTER list-building skills (`/prospeo-full-export`, `/blitz-list-builder`, `/google-maps-list-builder`, `/disco-like`)
- AFTER email waterfall (`/email-waterfall`)
- BEFORE Smartlead upload

## When NOT to use

- On a list of <100. Sample too small for reliable stats.
- On a fully static list (same every send). Check once, reuse.

## Scripts

- `scripts/score-list.ts` — the main scorecard

## What to do next

**If grade ≥ B:** `/campaign-copywriting` to write the emails. Then `/smartlead-campaign-upload-public` to launch as DRAFT.

**If grade < C:** fix the top 3 issues (from scorecard output), re-run this skill until grade ≥ B. Don't upload a C-grade list — bounces and low reply rates will damage domain reputation.

**Or wait:** if large fixes are needed (missing email verification, 30%+ bad titles), address those BEFORE spending more on email-finding or enrichment.

## Related skills

- `/icp-prompt-builder` — more surgical ICP fit scoring (AI per-company)
- `/icp-onboarding` — produces the `client-profile.yaml` this skill checks against
- `/email-waterfall` — run BEFORE this skill for verification coverage

## The 1% rule alignment

A list that scores below C-grade is very likely to produce reply rates below 1%, which violates the 1% rule (see `/email-deliverability-audit`). Catching list issues here saves you the deliverability hangover later.
