---
name: cold-email-weekly-rhythm
description: Operational playbook for running cold email continuously. Prescribes what to do on Monday / Wednesday / Friday / biweekly / monthly / quarterly. Use this as your ongoing cadence once your first campaign is live. What separates hobbyist from top 1% operators isn't tooling — it's consistency. This skill is the schedule.
---

# Cold Email Weekly Rhythm

Having 29 cold email skills doesn't help if you don't run them on a schedule. This is that schedule.

**This is a pure playbook.** No scripts, no automatic reminders. You put the rhythm on your own calendar (Step 1 below) and run the prescribed skill at the prescribed time. That's the entire system.

---

## Step 1 (required before using this skill): Put the rhythm on your calendar

Open Google Calendar / Outlook / Apple Reminders / whatever you actually look at every day. Create these as recurring events. Copy the titles and cadences exactly.

| Event title | Cadence |
|---|---|
| Cold email: Monday deliverability audit | Every Monday, 9:00 am |
| Cold email: Wednesday positive-reply sweep | Every Wednesday, 10:00 am |
| Cold email: Friday campaign retrospectives | Every Friday, 3:00 pm |
| Cold email: Inbox rotation | Every other Monday, 11:00 am |
| Cold email: Monthly spam placement test | 1st of each month, 10:00 am |
| Cold email: Quarterly experiment review | First Monday of each quarter, 1:00 pm |

**Do not skip Step 1.** The difference between hobbyist and top-1% cold email operators is that the top-1% operators actually run these tasks on their declared cadence, week after week. Your calendar is the accountability system. This skill doesn't have a built-in reminder — intentionally — because if it did and it broke, your ops would silently fail.

---

## Monday — Deliverability audit (15 min)

**Run:**

```bash
/email-deliverability-audit --days=7
```

(If using the scoped version: `audit-performance.ts --campaign-ids=<active campaign ids> --days=7`)

**Review:**

- Fleet reply rate over last 7 days — must be ≥1% (the 1% rule)
- Flagged campaigns (`flag_low_reply = TRUE`)
- Flagged inboxes (`flag_high_bounce = TRUE`)

**Action:**

- If any campaign failed the 1% rule: run `/deliverability-incident-response` → triage decision tree
- If bounce rate spiked above 2%: pause the offending campaign immediately, then triage
- If everything clean: log the check in a weekly journal, close the tab

---

## Wednesday — Positive-reply sweep (30-60 min depending on volume)

**Run:**

```bash
/positive-reply-scoring  # on all campaigns active in the last 7 days
```

**Review:**

- Any `positive_interested` or `positive_soft` replies — these are leads wanting to engage
- Any `positive_referral` replies — these are people saying "talk to Jane instead"
- Any `negative_hostile` replies — red flag, investigate

**Action:**

- Respond to every `positive_interested` reply within 30 seconds of seeing it. Do not batch these — a reply feeling like it took minutes to return converts 3× better than one that took hours.
- For referrals: reach out to the referred person within 24h, mention the referrer by name.
- For hostile: apologize, remove from all lists, investigate why they were flagged for hostility (often signals bad targeting).

**Time management:** if you have >50 positive replies per week, you're at the scale where you should hand off to a dedicated closer/AE. Do that handoff Wednesday morning so they can work replies by Wednesday afternoon.

---

## Friday — Campaign retrospectives (20 min per campaign)

**Identify campaigns hitting their 21-day mark this week.** (21 days is the minimum for reply-rate signal to stabilize.)

For each one:

1. Run `/positive-reply-scoring --campaign-id=<id>`
2. Compare to previous campaigns' positive reply rate baselines
3. Decide:
   - **Winner (positive reply rate ≥2×baseline):** keep running, consider scaling (clone to more inboxes)
   - **Middling (near baseline):** iterate on copy or list — run `/experiment-design` Monday to plan the next variant
   - **Loser (<50% of baseline):** kill it. Document why in the experiment log.

4. Log the result in `profiles/<slug>/experiments/<YYYY-MM-DD>-<campaign>.json`:
   - `positive_reply_rate`, `reply_rate`, `bounce_rate`
   - Your decision (keep / iterate / kill) + reasoning
   - Hypothesis for next iteration (if iterating)

**Critical:** do not skip the log. Over a quarter, these logs become the input for `/experiment-design` quarterly reviews. Without the history, you can't learn across campaigns.

---

## Every other Monday — Inbox rotation (30 min)

**Run:**

```bash
# Within /smartlead-inbox-manager skill:
npx tsx scripts/list-health.ts --all --out=health-$(date +%Y-%m-%d).csv
```

**Review the CSV:**

- Any inboxes with reputation "bad"?
- Any inboxes with `is_warmup_blocked: true`?
- Any inboxes with <5 sends/day despite being in active campaigns?

**Action:**

```bash
# Retire failing inboxes
npx tsx scripts/tag-inboxes.ts --ids=X,Y,Z --add-tag=retired --remove-tag=active
npx tsx scripts/set-warmup.ts --mode=disable --ids=X,Y,Z

# Promote insurance inboxes to active
npx tsx scripts/tag-inboxes.ts --ids=A,B,C --add-tag=active --remove-tag=insurance
npx tsx scripts/set-warmup.ts --mode=disable --ids=A,B,C
```

**If insurance pool is getting thin (<5 inboxes available to rotate in):** kick off a new domain purchase cycle via `/zapmail-domain-setup-public`. It takes ~2 weeks from purchase to sendable, so you need to start early.

---

## Monthly (1st of the month) — Spam placement test (25 min active, test runs ~20 min)

**Run:** the Smart Delivery spam placement test from `/email-deliverability-audit`:

```bash
npx tsx scripts/run-spam-test.ts --campaign-id=<highest volume active campaign> --senders=100
```

(Will use G Suite + Office365 provider pools. 100 senders is a sweet spot — large enough for statistical signal, small enough to avoid API stalls.)

**Review:**

- Overall inbox placement % — target: ≥85%
- Spam filter triggers — which filters fired, which senders affected

**Action:**

- **≥90% inbox placement:** great. Keep doing what you're doing.
- **80-90%:** yellow. Look at spam-filter-details. Start fixing the highest-frequency trigger next week.
- **<80%:** red. Pause the campaign, run `/deliverability-incident-response`, fix before sending more.

---

## Quarterly (first Monday of each quarter) — Experiment review (90 min)

Read all `experiments/*.json` from the last quarter. Identify patterns:

- Which campaigns had the highest positive reply rate?
- Which list sources produced the best leads?
- Which copy angles resonated (Observation → Implication? Pain? Social proof?)
- Which ICP archetypes converted best?

**Output:** a 1-page Q<N> retrospective saved to `profiles/<slug>/retrospectives/<YYYY>-Q<N>.md` with:

- Top 3 campaigns + what made them work
- Bottom 3 campaigns + what to avoid
- 3-5 hypotheses for next quarter's experiments
- Adjust ICP in `client-profile.yaml` if the data suggests a different segment performs better

Use the retrospective as input to design next quarter's experiments via `/experiment-design`.

---

## What to skip

You do NOT need to:

- Check Smartlead every day (Wednesday sweep catches everything important)
- Obsess over daily reply-rate fluctuations (wait for 7-day averages)
- Read every positive reply in real time — set up notifications if you want immediacy, but the Wednesday sweep is the system

Daily pokes at your cold email stack are a procrastination pattern, not a performance pattern.

---

## What to do next

This skill IS the loop. Your next action is the next calendar event on your list.

**Or if you haven't run a campaign yet:** skip this skill entirely. Come back after your first campaign hits the 7-day mark.

## Related skills

- `/email-deliverability-audit` — the Monday and Monthly tasks
- `/positive-reply-scoring` — the Wednesday and Friday tasks
- `/smartlead-inbox-manager` — the biweekly inbox rotation
- `/deliverability-incident-response` — when the Monday audit flags something
- `/experiment-design` — the quarterly retrospective feeds into this
- `/zapmail-domain-setup-public` — when insurance pool runs low
