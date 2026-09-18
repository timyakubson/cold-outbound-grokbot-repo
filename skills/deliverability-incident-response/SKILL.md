---
name: deliverability-incident-response
description: Triage playbook for when cold email deliverability breaks. Decision-tree guidance for "I landed in spam", "bounce rate spiked", "domain blacklisted", "inbox blocked in warmup", "reply rate dropped". Tells you what to check first, what to fix, and how long the fix takes. Pair with /email-deliverability-audit for diagnosis.
---

# Deliverability Incident Response

Things break. When they do, you need a playbook — not panic. This skill is the triage decision tree.

## The five incident types

| Symptom | Most likely cause | First action | Fix time |
|---|---|---|---|
| Reply rate dropped sharply | Deliverability — emails in spam | Run spam placement test | 1-14 days |
| Bounce rate spiked >3% | Bad list OR domain reputation | Check bounce types | 1-3 days |
| Domain blacklisted | Shared IP bad actor OR your domain got flagged | Check blacklists, rotate if needed | 7-30 days |
| Inbox blocked in warmup | Warmup network flagged sending patterns | Pause, investigate, maybe replace | 1-7 days |
| Gmail marking as promotional | Content triggers (links, images, HTML) | Simplify content | 1-3 days |

## Decision tree: "my reply rate dropped"

### Step 1: Quantify the drop

```
Was this week's reply rate < 50% of last 4 weeks' average?
  Yes → real drop, continue triage
  No  → noise, wait another week
```

If drop is real:

### Step 2: Is it campaign-specific or fleet-wide?

```
Are ALL campaigns dropping, or just one?
  All → fleet-level issue (infrastructure or copy pattern)
  One → campaign-specific (targeting, copy, list)
```

### Step 3: Fleet-wide drop — check these in order

1. **Smartlead Smart Delivery spam test** (`/email-deliverability-audit` → `run-spam-test.ts`)
   - If inbox placement <70% → real deliverability issue, skip to Step 4
   - If inbox placement >85% → deliverability is fine, look at copy/targeting instead

2. **Check domain authentication** (`/email-deliverability-audit` → `check-domain-auth.ts`)
   - Missing DKIM on any domain → fix immediately (see `/zapmail-domain-setup-public` for reconnect steps)
   - DMARC policy=reject with alignment failures → temporarily lower to quarantine

3. **Check warmup status** (`/smartlead-inbox-manager` → `list-health.ts`)
   - If multiple inboxes blocked in warmup → warmup network flagged you
   - If reputation dropped "good" → "fair" on many inboxes → slow down sending volume

4. **Check bounce rate** (`/email-deliverability-audit` → `audit-performance.ts`)
   - If bounce >3% → list quality degraded
   - If bounce <1% but reply rate low → emails landing in spam (Step 1 result)

### Step 4: You have a spam-placement problem — what to do

Time-ordered actions:

1. **Immediate (today):** Pause the highest-volume campaign. Stop damage.
2. **Day 1:** Run spam placement test on 2-3 sender subsets (tag=active vs tag=new). Find which cohort is worst.
3. **Day 1:** Check the spam-filter-details report from Smart Delivery — specifically which filters are firing. Common: `DKIM_INVALID`, `HTML_MESSAGE`, `LINK_REDIRECT`. Each has a specific fix.
4. **Day 2:** Fix the identified issues:
   - DKIM_INVALID → verify DKIM records across all domains, re-publish if needed
   - HTML_MESSAGE → simplify email body (fewer fonts, no inline CSS, no tracking pixels)
   - LINK_REDIRECT → remove or reduce links in email 1 (ideally 0 links)
5. **Day 3-14:** Slow down send volume. Cut daily send per inbox by 50% for a week. Reputation rebuilds slowly.
6. **Day 14:** Re-test spam placement. If back above 85% → resume normal volume.

## Decision tree: "bounce rate spiked"

### Step 1: What kind of bounces?

Smartlead categorizes bounces as hard (invalid address) or soft (temporary).

```
bounce_rate > 3% AND mostly_hard_bounces
  → list quality problem, verify with MillionVerifier

bounce_rate > 3% AND mostly_soft_bounces (greylist, temp)
  → domain reputation problem, slow sending

bounce_rate > 5% either type
  → stop the campaign immediately to prevent ISP suspension
```

### Step 2: If list problem

1. Export remaining leads from the campaign
2. Run through MillionVerifier (batch, ~$2 per 1,000)
3. Only reuse emails with status "ok"
4. Discard the rest

### Step 3: If reputation problem

Slow way down. Cut daily volume 50% per inbox for 2 weeks. Run warmup more aggressively.

## Decision tree: "domain blacklisted"

### Step 1: Confirm the blacklist

Check:
- Spamhaus, Barracuda, SURBL via `/email-deliverability-audit` → spam-test report → blacklist detail
- MX Toolbox (https://mxtoolbox.com/blacklists.aspx) for a second opinion

### Step 2: What tier of blacklist?

- **Domain on Spamhaus DBL or SURBL** → serious. You may need to replace the domain entirely.
- **Sending IP on a DNSBL** → usually the IP pool's fault (not yours, if on Zapmail shared IPs). Zapmail rotates IPs; wait 1-2 weeks.
- **Minor list (e.g., Barracuda)** → submit delisting request at their portal. Usually resolved in 3-7 days.

### Step 3: Replace vs repair

- **Domain <30 days old + blacklisted** → replace. Not worth the cleanup effort.
- **Domain >90 days old + blacklisted** → try repair. Stop sending for 7 days, submit delisting requests, slowly resume.
- **If you replace:** archive the old domain, buy a new lookalike via `/zapmail-domain-setup-public`, warm it for 2 weeks before reusing.

## Decision tree: "inbox blocked in warmup"

### Step 1: Why is it blocked?

Smartlead's `is_warmup_blocked: true` flag usually means:
- Your warmup emails looked like spam to the warmup network
- Too many warmup peers marked them as spam
- The inbox type/provider is rate-limiting

### Step 2: Triage

1. Check the `blocked_reason` field (if populated)
2. If warmup network issue → the inbox reputation may be damaged. Cost-benefit:
   - Young inbox (<30 days) → retire, provision new
   - Established inbox (>90 days, previously good reputation) → try disabling and re-enabling warmup with lower `total_warmup_per_day` (try 15 instead of 40)
3. If ISP rate-limit → wait 48h, re-enable warmup

### Step 3: Retire workflow (via `/smartlead-inbox-manager`)

```bash
# Tag as retired
npx tsx scripts/tag-inboxes.ts --ids=<id> --add-tag=retired --remove-tag=active

# Disable warmup
npx tsx scripts/set-warmup.ts --mode=disable --ids=<id>

# Replace — buy new domain, create new inbox
# See /zapmail-domain-setup-public
```

## Decision tree: "Gmail marking as promotional"

### Step 1: Test on a fresh Gmail account

Send the campaign's email 1 to a fresh @gmail.com account (yours, not in the campaign). Where does it land?

- Primary → you're fine
- Promotions → this is the issue
- Spam → you have a bigger deliverability problem (see above)

### Step 2: Promotional-tab triggers (and fixes)

- Multiple links in email → drop to 0-1 links in email 1
- Images / inline images → remove them
- Heavy HTML styling → simplify, fewer tags
- Marketing-style phrases ("click here", "act now", "limited time") → remove
- Unsubscribe in header (List-Unsubscribe) — actually helps deliverability, but formatting must be correct
- Mass signature blocks with logos → simplify to text-only

### Step 3: A/B test

Create two versions — your current and a stripped-down version. Send 50 leads each. Check which has better reply rate after 7 days.

## The 72-hour "total failure" checklist

If NOTHING is working and you don't know why:

1. **Pause all campaigns.** Stop damage.
2. **Audit:** run `/email-deliverability-audit` full suite
3. **Spam test:** run Smart Delivery on 2 sender subsets
4. **Check SPF/DKIM/DMARC on every domain** — if ANY are missing, fix before resuming
5. **Check Zapmail health dashboard** — if their IPs are in trouble, everyone on their pool is too
6. **Reduce volume 75%** for the restart
7. **Use a known-good copy** — don't launch new copy during recovery
8. **Watch reply rate daily** for 7 days post-restart

## When to call in experts

- You've been in spam for >2 weeks despite fixes → infrastructure level issue, consider migrating sending platforms
- Multiple domains permanently blacklisted → IP pool issue, switch providers
- Domain reputation never recovers after 4 weeks → retire domain, replace

## What to do next

**Re-run `/email-deliverability-audit --days=7` in 7 days** to confirm recovery. Domain/inbox reputation rebuilds slowly — don't re-audit before the 7-day window.

Meanwhile: continue the weekly rhythm via `/cold-email-weekly-rhythm`, which catches new issues as they emerge.

**Or wait:** if the incident required replacing domains/inboxes, wait 2 weeks for warmup on the replacements before expecting full recovery.

## Related skills

- `/email-deliverability-audit` — the diagnostic suite you run first
- `/smartlead-inbox-manager` — tag, rotate, retire inboxes
- `/zapmail-domain-setup-public` — replace a burned domain
- `/positive-reply-scoring` — confirm recovery (reply rate back to baseline)

## The 1% rule sanity check

After fixes, give it at least 200 sends at your normal volume. If reply rate is still <1% — there's a deeper issue. Start the playbook over.
