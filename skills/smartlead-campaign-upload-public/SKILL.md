---
name: smartlead-campaign-upload-public
description: Upload a CSV of leads + a variants YAML (produced by /campaign-copywriting) to Smartlead as a DRAFT campaign. Handles tag-scoped inbox selection, A/B/C variant assembly, custom field mapping, schedule config, and batch lead upload. ALWAYS creates in DRAFT — you review in Smartlead UI and hit Start manually. Use after /campaign-copywriting, just before the campaign goes live.
---

# Smartlead Campaign Upload

Takes a `variants.yaml` (written by `/campaign-copywriting`) and a `leads.csv` (from your list-building skills) and creates a DRAFT campaign in Smartlead. You review the result in the Smartlead UI and press Start manually.

**This skill does NOT ship any email copy.** Copy comes from `/campaign-copywriting`. This skill is the mechanical upload layer — API calls only.

## Why DRAFT only

Cold email launches should never happen from a script. You hit Start in the Smartlead UI after reviewing:
- Subject lines + body previews
- Inbox assignments (correct tag? correct count?)
- Lead count and a few random lead rows
- Schedule (timezone + hours + throttle)

The script sets all of this up in DRAFT so the review is trivial — verify and click Start.

## Inputs

### `leads.csv`

Required columns:
- `email`
- `first_name`
- `last_name`
- `company_name`

Optional columns (passed through to Smartlead as custom fields):
- `company_domain`
- `title`
- `linkedin_url`
- `situation_line` (AI-generated per-lead context)
- `value_line` (AI-generated value mapping)
- `cta_line` (AI-generated CTA angle)

Additional AI variable columns produced by `/campaign-copywriting` or `/personalization-subagent-pattern` — named fields only. The script does NOT accept arbitrary columns; this is intentional. If you need to add a field, update this skill.

### `variants.yaml`

Produced by `/campaign-copywriting`. Schema is in `references/variants-schema.yaml`.

Minimum required: `name`, `schedule`, `inbox_selection`, `sequences` with at least one step.

## Usage

```bash
export SMARTLEAD_API_KEY=xxx
npx tsx scripts/upload.ts \
  --leads=profiles/<slug>/campaigns/<campaign-slug>/leads.csv \
  --variants=profiles/<slug>/campaigns/<campaign-slug>/variants.yaml
```

Output:
```
✓ Campaign created: #12345678
✓ Sequence saved (3 steps, 3 variants on step 1)
✓ 20 inboxes attached (tag=active, LRU by daily_sent_count)
✓ 1,847 leads uploaded (20 batches)
✓ Schedule set (M-F 08:00-17:00 EST, 30/day/inbox)

Campaign is in DRAFT. Review + Start:
→ https://app.smartlead.ai/app/email-campaign/12345678
```

## Script flow

1. Load env (`SMARTLEAD_API_KEY` required)
2. Parse `leads.csv` — validate required columns, count rows
3. Parse `variants.yaml` — built-in minimal parser (~30 lines, no external dep)
4. `POST /campaigns/create` → get campaignId
5. `POST /campaigns/{id}/sequences` with all A/B/C variants
6. Query `/email-accounts?limit=100`, filter by `tag`, sort by `daily_sent_count` ASC (LRU), attach top N
7. Batch-upload leads (100 per batch) with standard custom fields mapped from CSV
8. `POST /campaigns/{id}/settings` (track off, stop on reply)
9. `POST /campaigns/{id}/schedule` with YAML values
10. Print campaign URL. **Do NOT activate.**

## Gotchas

- **Tag must exist and be applied to inboxes first.** Use `/smartlead-inbox-manager` to tag inboxes as `active` before running this upload.
- **Inbox count.** If `inbox_selection.count` exceeds tagged inboxes, the script attaches all available and warns.
- **Leads CSV size.** Tested up to 10K rows; larger runs may hit API rate limits. Script has built-in retry with exponential backoff.
- **Variants.yaml mismatch.** If `/campaign-copywriting` didn't produce the exact schema, the script fails fast with a clear error pointing at the offending field.
- **Email duplicates.** Smartlead deduplicates per campaign server-side. Still, dedupe your CSV first with `/list-quality-scorecard`.

## What to do next

**Open the Smartlead URL printed at the end. Review the campaign. Hit Start when satisfied.** The script deliberately does not auto-activate.

After Start:
- Wait 21 days, then run `/positive-reply-scoring` on the campaign to measure.
- Every Monday: run `/email-deliverability-audit --days=7` (see `/cold-email-weekly-rhythm`).

**Or wait:** if the best-practice check flagged issues, go back to `/campaign-copywriting` and revise before uploading.

## Related skills

- `/campaign-copywriting` — produces `variants.yaml`
- `/smartlead-inbox-manager` — required prep: inboxes must be tagged `active` before upload
- `/list-quality-scorecard` — dedupe + verify leads.csv before upload
- `/positive-reply-scoring` — run 21 days post-launch to measure
- `/cold-email-weekly-rhythm` — operational cadence after launch

## Files

- `scripts/upload.ts` — the upload script
- `references/variants-schema.yaml` — blank schema reference (no example copy content)
- `references/leads-csv-schema.md` — column spec
