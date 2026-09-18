---
name: positive-reply-scoring
description: Pulls replies from a Smartlead campaign, classifies each as positive/neutral/negative/OOO/bounce/unsubscribe using Claude, and reports the positive reply rate — the north-star metric for cold email. Use when the user wants to know if a campaign is actually working (not just getting replies, but getting the RIGHT replies). Triggers on "score my replies", "how's campaign X doing", "positive reply rate", "is this campaign working".
---

# Positive Reply Scoring

**Reply rate tells you if people are paying attention. Positive reply rate tells you if they want what you're selling.** This skill computes the second.

## Why this exists

A campaign can get 5% reply rate and still be a disaster. If 90% of those replies are "unsubscribe" and "not a fit," you're burning your domains for nothing.

The metric that matters is:
```
positive_reply_rate = positive_replies / total_sent
```

Compared side-by-side:
- Campaign A: 1% reply rate, 70% positive → 0.7% positive reply rate
- Campaign B: 5% reply rate, 10% positive → 0.5% positive reply rate
- Campaign A wins.

## Classification schema

Every reply is classified into exactly one bucket:

| Label | Meaning | Count as "positive"? |
|---|---|---|
| `positive_interested` | "Yes, tell me more" or booked a meeting | ✅ |
| `positive_soft` | "Send more info" / "reach out in Q3" / info request | ✅ |
| `positive_referral` | "Not me, but talk to X" | ✅ (referral is high-value) |
| `neutral_question` | Clarifying question, no commitment yet | ❌ (optional — some score as half) |
| `negative_notnow` | "Not right now, maybe later" | ❌ |
| `negative_notfit` | "Not a fit" / "we don't need this" | ❌ |
| `negative_hostile` | Angry reply, complaint, report | ❌ (and track separately as risk signal) |
| `unsubscribe` | Explicit opt-out | ❌ |
| `ooo` | Out-of-office auto-reply | ❌ (exclude from denominators) |
| `bounce` | Technical bounce | ❌ (exclude from denominators) |
| `other` | Can't tell | ❌ |

Positive reply rate = (positive_interested + positive_soft + positive_referral) / total_sent

## Inputs

- Smartlead API key (env: `SMARTLEAD_API_KEY`)
- Campaign ID to score
- Optional: client_id (if using a sub-client setup)
- Optional: date range (defaults to full campaign)

## Steps

### 1. Fetch all leads + replies from the campaign

Run the fetch script:

```bash
npx tsx scripts/fetch-campaign-replies.ts --campaign-id=12345 --out=/tmp/replies.json
```

This walks `/campaigns/{id}/leads` paginated, identifies leads with replies (`has_reply = true`), then fetches `/campaigns/{id}/leads/{lead_id}/message-history` for each, and writes them to a JSON file with one object per reply.

Output schema per reply:
```json
{
  "lead_id": "...",
  "email": "...",
  "lead_first_name": "...",
  "company": "...",
  "reply_time": "ISO timestamp",
  "reply_subject": "...",
  "reply_body": "... full text ...",
  "sequence_step": 1
}
```

### 2. Classify replies in the Claude Code conversation

Once the JSON is written, Claude (the one running this skill) reads the file and classifies each reply. For speed, fan out in batches of 20-30 via the Task tool (see `personalization-subagent-pattern` skill for fan-out mechanics).

Classification prompt (per batch):

```
Classify each reply as one of:
- positive_interested, positive_soft, positive_referral
- neutral_question
- negative_notnow, negative_notfit, negative_hostile
- unsubscribe, ooo, bounce, other

For each reply, output: { lead_id, label, confidence: 0.0-1.0, one_line_reason }

Rules:
- OOO auto-replies ("I'm out of office") → ooo
- Bounces (delivery failure messages) → bounce
- "Take me off your list", "unsubscribe", "STOP" → unsubscribe
- "Not interested", "not a fit" → negative_notfit
- "Not right now, circle back in Q3" → negative_notnow
- "Try [other person]" → positive_referral
- "Send more info" or "Tell me more" → positive_soft
- "Yes, let's book a call", "what times work" → positive_interested
- Insults, reports, legal threats → negative_hostile

If confidence < 0.7, label as `other`.
```

### 3. Aggregate + compute rates

Run the aggregator:

```bash
npx tsx scripts/aggregate-scores.ts --replies=/tmp/classified-replies.json --campaign-id=12345
```

Output (to stdout + optional `--out`):

```
Campaign 12345 — Positive Reply Scoring

Total sent:              5,284
Total replies:              212 (4.01%)
  ooo/bounce (excluded):    34
  Net replies:             178

Breakdown:
  positive_interested:    22
  positive_soft:          31
  positive_referral:       8
  neutral_question:       14
  negative_notnow:        28
  negative_notfit:        52
  negative_hostile:        3
  unsubscribe:            20
  other:                   0

Positive reply rate:     1.15% (61 / 5,284)
Positive % of replies:   34.3% (61 / 178)
Negative hostile risk:    0.06% (3 / 5,284)
Unsub rate:              0.38% (20 / 5,284)

Benchmarks (B2B cold email):
  Good positive reply rate: ≥1%
  Great: ≥2%
  Hostile >0.3% or unsub >2% → deliverability risk, pause campaign
```

### 4. Save to disk

Write aggregate results to:
```
~/cold-email-ai-skills/profiles/<business-slug>/scores/<campaign-id>-<YYYY-MM-DD>.json
```

This builds a history so you can trend positive reply rate over campaigns.

### 5. Flag action items

At the end, surface:

- **Positive replies that need a human response** — list the top 10 `positive_interested` leads and their reply bodies. The user should reply to these within 30 seconds of seeing this report.
- **Referrals that need follow-up** — `positive_referral` labels. Add the referred contacts to a new outreach list.
- **Hostile flags** — any `negative_hostile` replies. Read them manually; consider pausing the inbox if someone is genuinely angry.
- **Unsubscribes** — confirm they're globally suppressed (Smartlead does this automatically, but double-check).

## When to use this skill

- After a campaign has run for at least 14 days (otherwise sample is too small)
- When comparing two campaigns in an experiment (use the same cutoff date for both)
- Weekly as a quality check on running campaigns
- Before deciding to kill or scale a campaign

## Common gotchas

- **Don't trust reply rate alone.** A 5% reply rate from spam-trap replies and unsubscribes is worse than a 2% reply rate from real buyers.
- **Exclude OOO + bounce from denominators.** They're not real replies. The script does this automatically.
- **Smartlead's built-in AI categorization** exists but is less controllable. This skill uses Claude directly for transparency and prompt-tunable classification.
- **Small samples lie.** Below ~500 sent, the positive reply rate has too much noise. Wait for more volume before declaring winners/losers.
- **Classify only FIRST reply per lead.** If a lead replied, you replied, they replied again — only the first reply is the signal. Later messages are the conversation, not the scoring.

## What to do next

**Respond to every `positive_interested` reply within 30 seconds** of seeing it. Then `/experiment-design` to plan the next iteration based on what worked.

**If positive reply rate is <1% after 200+ sends:** the 1% rule failed. Run `/email-deliverability-audit` (are you reaching the inbox?) (check for vague CTAs, generic first lines, em dashes).

**Or wait:** this skill is the Wednesday task in `/cold-email-weekly-rhythm`. Run it weekly going forward.

## Related skills

- `/experiment-design` — uses positive reply rate as the success metric
- `/email-deliverability-audit` — if hostile + unsub are elevated, run this next
- `/cold-email-starter-kit` → `10-reply-handling.md` for what to do with the positive replies once flagged

## Scripts

- `scripts/fetch-campaign-replies.ts` — pulls replies via Smartlead API
- `scripts/aggregate-scores.ts` — computes rates from classified JSON
