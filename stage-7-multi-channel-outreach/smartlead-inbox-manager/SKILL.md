---
name: smartlead-inbox-manager
description: Programmatic inbox management for Smartlead. Enable/disable warmup with correct ramp settings, set signatures in bulk, tag inboxes (active vs insurance), and pull inbox health dashboards. Use after creating a new batch of inboxes via /zapmail-domain-setup-public, or when managing an existing Smartlead account at scale. Triggers on "turn on warmup", "set signatures", "tag inboxes", "inbox health", "set up new inboxes".
---

# Smartlead Inbox Manager

Zapmail hands you hundreds of new inboxes. Smartlead needs them configured: warmup enabled with the right ramp, signatures set so emails don't look bare, tags applied so you know which are active vs insurance, and health monitored so dead inboxes get recycled.

This skill does all of that via the Smartlead API.

## Core operations

| Operation | What it does | Script |
|---|---|---|
| Enable warmup | Turns on warmup with correct ramp (start 1/day, +5/day up to 40/day) | `set-warmup.ts --mode=enable` |
| Disable warmup | Turns off warmup (use for insurance inboxes) | `set-warmup.ts --mode=disable` |
| Set signatures | Bulk-applies a signature template to inboxes | `set-signatures.ts` |
| Tag as active | Adds the "active" tag | `tag-inboxes.ts --tag=active` |
| Tag as insurance | Adds the "insurance" tag | `tag-inboxes.ts --tag=insurance` |
| Health dashboard | Lists all inboxes with warmup status, reputation, daily sent | `list-health.ts` |

## Active vs insurance (the tagging convention)

Not every inbox should send all the time. A common pattern:

- **Active inboxes** — currently sending in live campaigns. Warmup OFF (or minimal) to prioritize real sends.
- **Insurance inboxes** — warmed but idle, held in reserve. Warmup ON to maintain reputation. Swap in when an active inbox burns out.

Tags are how you track this at scale. Filter by tag in Smartlead UI or via API.

## Inputs

Every script reads:
- `SMARTLEAD_API_KEY` (env var)
- Inbox selector: `--ids=1,2,3` OR `--domain=example.com` OR `--tag=insurance` OR `--all`
- Operation-specific flags (see each script)

## Warmup ramp settings

Default warmup config for a NEW inbox (week 1-4 of warmup period):

```json
{
  "warmup_enabled": "true",
  "total_warmup_per_day": 40,
  "daily_rampup": 5,
  "reply_rate_percentage": "20"
}
```

- `total_warmup_per_day`: max emails/day the inbox sends in warmup network (peak)
- `daily_rampup`: increment per day (day 1 = 1, day 2 = 6, day 3 = 11, etc. up to the cap)
- `reply_rate_percentage`: how often warmup peers reply (20% is realistic)

For INSURANCE inboxes (maintaining reputation long-term):
```json
{
  "warmup_enabled": "true",
  "total_warmup_per_day": 15,
  "daily_rampup": 0,
  "reply_rate_percentage": "20"
}
```

Lower volume, no ramp — just keeps the inbox warm.

For ACTIVE inboxes (currently in live campaigns):
```json
{
  "warmup_enabled": "false"
}
```

Warmup off so the daily send budget goes to real prospects.

## Signature template

The default template, applied in bulk via `set-signatures.ts`, is:

```
{from_name}
{title}
{company}
{address}
```

Rendered (for example):
```
Jane Smith
Founder
Acme
123 Main St, Suite 400, Austin, TX 78701
```

**Where each value comes from:**
- `{from_name}` — the inbox's own `from_name` field if set (different personas per inbox), else `SENDER_FIRST_NAME + SENDER_LAST_NAME` from `.env`
- `{title}` — `SENDER_TITLE` env var
- `{company}` — `SENDER_COMPANY_NAME` env var
- `{address}` — `SENDER_PHYSICAL_ADDRESS` env var (recommended — a real mailing address in the footer keeps you on the right side of CAN-SPAM and similar rules)

**Required `.env` entries for the default template:**
```
SENDER_FIRST_NAME=Jane
SENDER_LAST_NAME=Smith
SENDER_TITLE=Founder
SENDER_COMPANY_NAME=Acme
SENDER_PHYSICAL_ADDRESS=123 Main St, Suite 400, Austin, TX 78701
```

**Custom template override:**
```bash
# Pass inline (use \n for newlines)
npx tsx scripts/set-signatures.ts --all --template="Cheers,\n{from_name}\n{title}\n{company}\n{address}"

# Or from a file
npx tsx scripts/set-signatures.ts --all --template-file=./my-signature.txt
```

Available placeholders: `{from_name}`, `{from_email}`, `{domain}`, `{title}`, `{company}`, `{address}`.

**Email body order in campaigns:**

In Smartlead sequences, always end the body with `%signature%` — Smartlead injects the inbox's signature there. Order:
```
<body content>

<PS unsubscribe line>

%signature%
```

This puts `%signature%` (with name + title + company + address) on the bottom, so every inbox sends with a real mailing address in the footer.

## Health dashboard output

`list-health.ts` prints a CSV + summary:

```
email                              warmup   reputation   sent_today   health_status
john@example.co                    on       good         18           healthy
jane@example.co                    on       fair         5            warming
sales@other.co                     off      n/a          28           active
support@other.co                   on       bad          0            blocked
```

Summary:
```
Total inboxes: 80
  Warmup on: 50
  Active (warmup off): 28
  Blocked/failed: 2

Reputation:
  Good: 65
  Fair: 10
  Bad: 3
  Unknown: 2

Action items:
  - 2 inboxes blocked — run /email-deliverability-audit
  - 3 inboxes with "bad" reputation — consider pausing
```

## Common workflows

### Day 1 after Zapmail provisioning

```bash
# 1. Enable warmup on all newly created inboxes
npx tsx scripts/set-warmup.ts --mode=enable --tag=new --warmup-per-day=40 --ramp=5

# 2. Set signatures
npx tsx scripts/set-signatures.ts --tag=new --template="Best,\n{from_name}"

# 3. Tag them as insurance (they aren't active yet — warmup for 2 weeks first)
npx tsx scripts/tag-inboxes.ts --tag=new --add-tag=insurance
npx tsx scripts/tag-inboxes.ts --tag=new --remove-tag=new
```

### Activating insurance inboxes into a live campaign

```bash
# 1. Identify warm insurance inboxes with good reputation
npx tsx scripts/list-health.ts --tag=insurance --filter=reputation:good --out=activate-candidates.csv

# 2. Flip them to active
npx tsx scripts/tag-inboxes.ts --ids-from-csv=activate-candidates.csv --add-tag=active --remove-tag=insurance

# 3. Disable warmup (they're sending for real now)
npx tsx scripts/set-warmup.ts --mode=disable --tag=active
```

### Weekly health check

```bash
npx tsx scripts/list-health.ts --all --out=health-$(date +%Y-%m-%d).csv
```

Review the action items. Replace blocked inboxes.

## The 1% rule — when to retire an inbox

**A healthy inbox should have an overall reply rate of ≥1% after sending 200+ emails.** Below that, it's likely burned or has poor deliverability.

To identify inboxes failing this rule:

```bash
# Run the audit to find offenders
/email-deliverability-audit → scripts/audit-performance.ts --days=30 --out=/tmp/audit/performance.csv

# Then tag the failing inboxes as retired
cat /tmp/audit/performance.csv | awk -F',' '$11 == "\"true\"" { print $1 }' > /tmp/retire-ids.txt
npx tsx scripts/tag-inboxes.ts --ids-from-csv=/tmp/retire-ids.txt --add-tag=retired --remove-tag=active
npx tsx scripts/set-warmup.ts --mode=disable --tag=retired
```

## Common gotchas

- **Warmup settings are per-inbox.** There's no global setting. Scripts loop and hit each inbox individually.
- **Rate-limiting.** Smartlead allows ~33 req/sec. The scripts use 5 concurrent by default. Don't crank this higher without testing.
- **Warmup blocked.** If `is_warmup_blocked: true`, the inbox is flagged (usually for spam-like behavior in warmup). Manual investigation needed.
- **Tags have no delete endpoint** in some Smartlead versions — tags can only be ADDED. To "remove" a tag, replace the full tag list with a new one that omits it. The script handles this automatically.
- **Signature formatting.** HTML signatures can break rendering across Gmail/Outlook/Apple Mail. Keep it plain text or use minimal `<br>` tags. Test in Gmail/Outlook after setting.
- **Warmup ramp accumulates.** If you set `daily_rampup: 5`, the inbox sends 1 on day 1, 6 on day 2, 11 on day 3... up to `total_warmup_per_day`. To reset (e.g. after a break), disable then re-enable.

## What to do next

**If you just provisioned new inboxes:** enable warmup (`set-warmup.ts --mode=enable`), apply signatures (`set-signatures.ts`), tag as `insurance`, then **wait 2 weeks for warmup**. After 2 weeks, promote `insurance` → `active`.

**If inboxes are already warm:** proceed to list-building (`/prospeo-full-export`, `/disco-like`, etc.) using `active`-tagged inboxes.

**Or wait:** if health dashboard shows bad-reputation inboxes, retire them first (tag `retired`, disable warmup) before launching a new campaign.

## Related skills

- `/zapmail-domain-setup-public` — creates the inboxes this skill configures
- `/email-deliverability-audit` — when health dashboard shows problems
- `/smartlead-api` — underlying API reference

## Scripts

- `scripts/set-warmup.ts` — enable/disable warmup, configure ramp
- `scripts/set-signatures.ts` — bulk signature setting
- `scripts/tag-inboxes.ts` — add/remove tags
- `scripts/list-health.ts` — health dashboard CSV + summary
- `scripts/_lib.ts` — shared: API client, inbox selector parser, concurrency
