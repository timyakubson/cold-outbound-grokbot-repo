---
name: auto-research-public
description: Autonomous cold email campaign launcher. Takes one target company domain, scrapes their website, generates an ICP with Claude, pulls matching leads via Prospeo, enriches emails + company descriptions, personalizes each lead with parallel Claude Code Task sub-agents (A/B/C variants), and uploads as a live Smartlead campaign. Uses local JSON files for state (no database required). Use for automated daily campaign launches after you have an initial `client-profile.yaml` from /icp-onboarding. Triggers on "auto-research", "launch an automated campaign", "daily campaign", "run the research loop".
---

# Auto Research (Public)

Automated end-to-end campaign launcher. Feed it one target company domain, get back a live Smartlead campaign with per-lead personalization — in about 20 minutes.

This is the beginner-friendly version of the GEX internal `auto-research-v2`. All state lives in local JSON files; no Supabase, no Trigger.dev.

## What you get

- **Input:** one target company domain + your `client-profile.yaml`
- **Output:** a running Smartlead campaign with:
  - 200-1,000 leads (depending on targeting tightness)
  - Per-lead personalization: 9 custom variables (situation, value, CTA × 3 variants)
  - A/B/C subject + body variants tested in parallel
  - Campaign assigned to your available inboxes
  - Schedule: Mon-Fri 8am-5pm your timezone

## Prerequisites

Before running:
- [ ] `client-profile.yaml` exists (run `/icp-onboarding` if not)
- [ ] `SMARTLEAD_API_KEY` in env
- [ ] `PROSPEO_API_KEY` in env
- [ ] `MILLIONVERIFIER_API_KEY` in env (for email validation)
- [ ] At least 20 Smartlead inboxes tagged "active" (run `/smartlead-inbox-manager` first)
- [ ] At least 1 campaign template in Smartlead (or the script creates a fresh one)

## The orchestration (Claude Code runs this)

Unlike the other skills, this skill orchestrates through the Claude Code conversation itself — Claude does the reasoning (ICP generation, copy writing, personalization), and phase scripts do the heavy API I/O. This is the pattern from the GEX v2 internal.

### Phase 1: Scrape the target company

```bash
npx tsx scripts/phase-scrape.ts --domain=<target.com> --out=/tmp/auto/scrape.json
```

Output: JSON with `domain` + text content from homepage, /about, /product, /pricing, /customers.

Claude reads the output and writes a short analysis to `/tmp/auto/company-analysis.md`:
- What the company does
- Who their likely customers are
- Social proof signals
- Potential angles for outreach

### Phase 2: Claude generates ICP filters

Reading `/tmp/auto/scrape.json` + `~/cold-email-ai-skills/profiles/<slug>/client-profile.yaml`, Claude writes Prospeo filters to `/tmp/auto/filters.json`:

```json
{
  "job_titles": ["VP Marketing", "Head of Marketing", ...],
  "seniorities": ["Vice President", "Head", "Director"],
  "industries": ["Software Development", "Financial Services"],
  "company_size_min": 50,
  "company_size_max": 500,
  "countries": ["US"],
  "excluded_industries": ["Religious Institutions", "Government Administration"]
}
```

Claude MUST use exact Prospeo industry names from `~/cold-email-ai-skills/skills/icp-onboarding/references/prospeo-industries.md`.

### Phase 3: Prospeo search

```bash
npx tsx scripts/phase-prospeo.ts --filters-file=/tmp/auto/filters.json --max-leads=1000 --out=/tmp/auto/leads.json
```

Output: JSON with `leads` array. Each lead has: `first_name`, `last_name`, `email` (may be empty), `linkedin_url`, `job_title`, `company_name`, `company_domain`, `company_industry`, `company_headcount`, `company_description`.

### Phase 4: Email waterfall + description enrichment

```bash
npx tsx scripts/phase-enrich.ts --leads-file=/tmp/auto/leads.json --out=/tmp/auto/enriched.json
```

The script:
1. Checks each lead for email; if missing, hits Prospeo's `enrich-person` endpoint
2. If company_description is thin (<50 chars), scrapes company_domain homepage
3. Runs MillionVerifier on every candidate email
4. Writes enriched leads (only those with valid email) to output

Expect hit rates:
- Retail/SMB: ~99% email found
- B2B tech: ~65-80%
- Healthcare/public sector: ~25-40%
- MV rejection: ~20-30% of found emails

### Phase 5: Copy writing (Claude)

Claude generates 3 copy variants (A, B, C) and writes to `/tmp/auto/variants.json`:

```json
[
  {
    "variant": "A",
    "subject": "<concrete, specific, <60 chars>",
    "angle": "<pain observation>",
    "body_template": "Hi {{first_name}},\n\n{{situation_line_a}}\n\n{{value_line_a}}\n\n{{cta_line_a}}\n\n%signature%\n\nP.S. If this isn't relevant, just let me know and I won't reach out again."
  },
  {
    "variant": "B",
    "subject": "<different angle>",
    "angle": "<compliment + transition>",
    "body_template": "..."
  },
  {
    "variant": "C",
    "subject": "<third angle>",
    "angle": "<question>",
    "body_template": "..."
  }
]
```

Rules Claude MUST follow (run `/spam-word-checker` on output):
- No em dashes (—). Use commas or periods.
- No "leverage", "synergy", "solutions", "world-class", "cutting-edge".
- Body: 50-90 words max.
- Subject: under 60 chars, specific, no clickbait.
- End with `%signature%` on its own line.

### Phase 6: Personalization via Task sub-agents

Claude fans out to parallel Task sub-agents (one per variant × batch of 20-30 leads). See `/personalization-subagent-pattern` for the full pattern.

Per lead, each sub-agent writes to `/tmp/auto/personalization-<batch>-variant-<X>.json`:

```json
[
  {
    "lead_id": "...",
    "situation_line": "One sentence about the company.",
    "value_line": "One sentence connecting to our offer.",
    "cta_soft": "One soft ask sentence."
  }
]
```

After all sub-agents finish, Claude merges by lead_id into `/tmp/auto/personalized.json`. Each lead now has 9 personalization fields.

### Phase 7: Upload to Smartlead

```bash
npx tsx scripts/phase-upload.ts \
  --leads-file=/tmp/auto/personalized.json \
  --variants-file=/tmp/auto/variants.json \
  --domain=<target.com> \
  --inboxes-tag=active \
  --inbox-count=10 \
  --activate
```

This script:
1. Creates a new Smartlead campaign named `[AUTO] <date> <target> Auto`
2. Saves the 3-variant sequence with campaign-ID-scoped custom vars (`{{situation_line_a_{campaign_id}}}`)
3. Selects N inboxes tagged "active" from Smartlead (LRU — least recently used first)
4. Uploads leads in batches of 100 with custom fields mapped to their personalization
5. Sets schedule (Mon-Fri 8am-5pm EST) and settings (tracking off, stop on reply)
6. Activates the campaign

Outputs: `{ campaignId, inboxCount, leadsUploaded }` to stdout.

### Phase 8: Save experiment state (local JSON)

Write to `~/cold-email-ai-skills/profiles/<slug>/experiments/<YYYY-MM-DD>-<target>.json`:

```json
{
  "date": "2026-04-17",
  "target_domain": "example.com",
  "smartlead_campaign_id": 123456,
  "inboxes_assigned": [...],
  "icp_filters": {...},
  "variants": [...],
  "lead_count_uploaded": 347,
  "launched_at": "2026-04-17T14:23:00Z",
  "status": "launched"
}
```

This is your experiment log. `/experiment-design` reads from here to compare runs. `/positive-reply-scoring` writes results back to this file after 21 days.

## Running the full loop

To run all 8 phases in one command (with Claude orchestrating):

```
/auto-research-public --domain=<target.com>
```

Claude Code will execute each phase in order, pausing before phase 5 (copy) and phase 7 (upload) so you can review.

## Daily / scheduled runs

Once comfortable, wrap it in a cron or use Claude Code's `/loop` skill to run daily:

```
/loop 1d /auto-research-public --domain=$(cat /tmp/auto/next-target.txt)
```

You need a way to pick the next target each day. Options:
- Maintain a `targets.txt` list and pop one per day
- Let Claude pick based on TAM research (see `/GEX:Full-TAM-Waterfall` for inspiration)
- Rotate through a list of competitors/lookalikes

## State files (local JSON, no database)

Everything the skill needs lives under `~/cold-email-ai-skills/profiles/<slug>/`:

```
profiles/
  <business-slug>/
    client-profile.yaml          # from /icp-onboarding
    lead-magnets.md              # from /lead-magnet-brainstorm
    experiments/
      2026-04-16-targetco.json   # per-campaign experiment log
      2026-04-17-othertarget.json
    scores/
      123456-2026-05-07.json     # from /positive-reply-scoring
```

## Inbox assignment (no Supabase)

The GEX v2 uses a Supabase table `auto_research_inbox_assignments` to track which inboxes are assigned to which campaigns (to spread load). This public version:

1. Queries Smartlead for inboxes tagged "active"
2. Pulls each inbox's `daily_sent_count` as a proxy for "how recently used"
3. Sorts ascending, picks the first N (least-sent-today = least recently used)
4. Records the assignment in the local experiment JSON (not a database)

Works for <1000 inboxes. If you scale beyond that, migrate to a real DB.

## Common issues

- **Prospeo INVALID_FILTERS** — Usually "industry name not in the 256 list." Check `/icp-onboarding` references/prospeo-industries.md for exact matches.
- **Low email hit rate** — If <30%, your list is targeting hard-to-find people (niche titles, small companies). Widen ICP or accept the cost.
- **Sub-agent personalization repetitive** — If you see the same phrasing across leads, rerun that batch with a diversity prompt. See `/personalization-subagent-pattern` references/failure-modes.md.
- **Smartlead "inbox not allowed" on upload** — Inbox is flagged/blocked. The script skips and continues.
- **Campaign stuck at 0 sends** — Check campaign schedule, inbox warmup status (via `/smartlead-inbox-manager list-health`), and that leads actually uploaded.

## Cost per run

Typical run (1 target, 1000 leads pulled):
- Prospeo search: ~40 pages × search = ~$0.20
- Prospeo enrich-person (email finding for ~500 leads missing email): ~$5
- MillionVerifier validation: ~$0.50
- Smartlead send cost: ~$0.001/email sent over time
- Claude Code Task sub-agents: (uses your Claude Code plan — no extra API spend)

Total: **~$6-10 per campaign** to reach 300-500 valid emails.

## Scripts

- `scripts/phase-scrape.ts` — website scrape
- `scripts/phase-prospeo.ts` — Prospeo paginated search
- `scripts/phase-enrich.ts` — email waterfall + description enrichment + MillionVerifier
- `scripts/phase-upload.ts` — Smartlead campaign creation + upload
- `scripts/_lib.ts` — shared API helpers

## References

- `references/orchestration-checklist.md` — full step-by-step for running the loop manually
- `references/icp-to-prospeo.md` — how to translate client-profile.yaml into Prospeo filter JSON
- `references/copy-variant-guide.md` — how to write 3 distinct A/B/C variants

## What to do next

**Wait 21 days** for the campaign to accumulate reply data, then run `/positive-reply-scoring` on the launched campaign.

**Meanwhile:** continue the weekly rhythm via `/cold-email-weekly-rhythm`. Every Monday, `/email-deliverability-audit` on the new campaign to catch infrastructure issues early.

**Or wait:** this skill IS the automation loop. Next action can be "run again tomorrow with a different target domain" or integrate with `/schedule` skill to run daily.

## Related skills

- `/icp-onboarding` — produces client-profile.yaml (required input)
- `/lead-magnet-brainstorm` — produces the offer/CTA this campaign asks about
- `/personalization-subagent-pattern` — the fan-out pattern used in phase 6
- `/smartlead-inbox-manager` — must run BEFORE so inboxes are tagged/warmed
- `/positive-reply-scoring` — run AFTER 21 days to score the campaign
- `/experiment-design` — how to plan which target to try next
