# leads.csv — required columns and allowed custom fields

The upload script accepts a CSV with these columns. Extra columns are rejected to prevent accidental PII upload or schema drift.

## Required columns

| Column | Type | Notes |
|---|---|---|
| `email` | string | Must be valid email. Script does not re-verify (use `/list-quality-scorecard` or MillionVerifier first). |
| `first_name` | string | Used in `{{first_name}}` merge |
| `last_name` | string | Used in `{{last_name}}` merge |
| `company_name` | string | Used in `{{company_name}}` merge. NOTE: `/campaign-copywriting` requires `{{company_name}}`, never `{{company}}`. |

## Allowed optional columns

Passed through to Smartlead as custom fields. The column name becomes the merge variable (so `{{title}}`, `{{company_domain}}`, etc).

| Column | Use |
|---|---|
| `company_domain` | Reference to their website |
| `title` | Job title |
| `linkedin_url` | Profile link |
| `situation_line` | AI-generated per-lead specific observation (output of `/personalization-subagent-pattern` or `/campaign-copywriting`) |
| `value_line` | AI-generated value connection |
| `cta_line` | AI-generated CTA angle |

## Not allowed

Any column not listed above will cause the script to abort with a clear error. This is intentional — it prevents:
- Accidental PII columns (addresses, phone, DOB, etc) being uploaded
- Misspelled custom field names that fail silently in Smartlead
- Schema drift where the copywriter uses merge fields the list doesn't have

If you need a new field, update this skill (add the column here + update `upload.ts` allowlist).

## Example header row

```csv
email,first_name,last_name,company_name,company_domain,title,situation_line,value_line,cta_line
```

## Quality pre-checks before upload

Run `/list-quality-scorecard` first. Confirm:
- 100% of emails verified (`email_status=ok` or run MillionVerifier)
- <1% duplicate rate
- <5% catch-all addresses
- ICP fit ≥ 80%
- Letter grade ≥ B

If grade < C, don't upload — fix the list first.
