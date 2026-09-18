---
name: icp-onboarding
description: Conversational intake for cold email campaigns. Interviews the user about their business, ICP (Ideal Customer Profile), offer, lead magnets, and hard vs soft filters. Outputs a structured `client-profile.yaml` that every other skill in the repo reads from. Use at the very start of a new campaign or when onboarding a new business. Triggers on "onboard me", "set up my ICP", "new client", "new business intake", "help me define my ICP".
---

# ICP Onboarding

Conversational intake. The user arrives with a business; this skill produces a `client-profile.yaml` every other skill in the repo consumes. Without it, downstream skills guess at targeting and write generic copy.

## Why this exists

Most cold email fails because the sender didn't define the ICP tightly enough. "B2B SaaS founders" is not an ICP. "VP of RevOps at 50-500 person B2B SaaS companies in the US that raised Series B in the last 12 months" is an ICP — you can put it into Prospeo and get a list.

This skill forces that precision up front. It also separates **hard filters** (must match) from **soft preferences** (nice-to-have), because the #1 mistake beginners make is treating every ICP criterion as required, ending up with a list of 200 leads instead of 5,000.

## Inputs

Either:
- **Website URL** of the user's business (skill will scrape + infer a lot)
- **Plain description** ("I sell X to Y") if no website

## Outputs

A single file: `~/cold-email-ai-skills/profiles/<business-slug>/client-profile.yaml`

## Steps

### 1. Ask for the website URL FIRST (required)

Before any interview questions, ask:

> "What's the website of the business you're running cold email for?"

If the user provides a URL:

```bash
npx tsx scripts/scrape-website.ts --url=https://example.com --out=/tmp/scrape.json
```

Then READ the scraped JSON and immediately produce a one-paragraph summary for the user:

> "Based on your website, here's what I understand about your business:
>
> **<Company name>** sells <product/service in one sentence> to <who they sell to, based on case studies + homepage>. Their core value proposition appears to be <summary>. Notable social proof: <logos, metrics, awards>. Pricing signal: <free tier / self-serve / enterprise / unclear>.
>
> **Proposed ICP starting point:** <titles + industries + size inferred from case studies>.
>
> Does that sound right? Any corrections before I start the interview?"

This summary is NOT the final ICP — it's the anchor. The user's corrections here save 5+ minutes in the interview.

If the user has no website:
> "OK, no website. Give me a two-sentence description of what you sell and to whom. I'll use that as the anchor for the rest of the interview."

### 2. Interview the user (using scraped context)

Ask these questions in order. Do NOT batch them — wait for each answer before asking the next. Keep answers short. Use the scraped content to PRE-FILL proposed answers where possible, and ask the user to confirm or correct.

1. **What do you sell in one sentence?** *Pre-fill:* "Based on your site, you sell `<X>`. Confirm or correct?"
2. **Who is your single best customer — name them.** (Helps anchor everything else. If they hesitate, ask for the last 3 customers by revenue or fit. If case studies on the website name customers, propose those.)
3. **What job title buys this?** (Push back if they say "CEO" for anything >50 employees. Probably not true.)
4. **Headcount range — hard minimum and hard maximum?** (E.g. 20-500. Not "enterprise" — actual numbers.)
5. **Industries — in or out?** (Use the Prospeo industry taxonomy: see `references/prospeo-industries.md`. Mark IN or OUT — no fuzzy.)
6. **Geography — countries only, or specific states/regions?**
7. **Any triggers that matter?** (Recent fundraise, new hires in a role, tech on website, recent product launch, specific Google Ads spend.)
8. **Any disqualifiers?** (Competitors, existing customers, partners — domains to exclude.)
9. **Your offer / hook — what are you asking them to do?** (E.g. "book a 15-min call", "try our free audit", "reply with a Y and I'll send details".)
10. **Lead magnet — what can you legally give away for free?** (If they don't have one, invoke `/lead-magnet-brainstorm` skill.)
11. **Tone — casual or formal? Peer-to-peer or vendor-to-buyer?**
12. **Banned words / legal constraints** (any industries that restrict language, e.g. healthcare, finance, crypto).

### 3. Translate into Prospeo filters

Take the answers and draft Prospeo-compatible filters:
- Job titles → exact titles + common synonyms (VP of Sales = VP Sales = Head of Sales = SVP Sales)
- Industries → match the 256 valid Prospeo industry names. See `references/prospeo-industries.md`.
- Headcount → map to Prospeo buckets (1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10001+)
- Geography → country codes or state lists

### 4. Split hard vs soft

For each criterion, explicitly ask: **"If you find someone who matches everything except this, do you reach out anyway — yes or no?"**
- YES → soft preference (log it, but don't filter on it)
- NO → hard filter (must match)

Common answers:
- Job title: usually HARD
- Industry: usually HARD (if targeting a vertical)
- Headcount: usually SOFT on the edges (one person above the cap is often fine)
- Trigger (funded, hired, etc): ALMOST ALWAYS SOFT — it's a personalization signal, not a filter

### 5. Write `client-profile.yaml`

Use this schema:

```yaml
business:
  name: <business name>
  website: <url>
  one_liner: <what they sell>
  tone: <casual|formal|peer-to-peer>

offer:
  primary_cta: <what you ask the lead to do>
  lead_magnet: <free thing you can give>
  value_prop: <why they should care, one sentence>

icp_hard_filters:
  job_titles:
    - <exact title>
    - <synonym>
  industries_in:
    - <prospeo industry>
  industries_out:
    - <prospeo industry>
  headcount_min: <int>
  headcount_max: <int>
  countries:
    - <country code>
  states: []  # US only, optional
  excluded_domains:
    - <competitor.com>
    - <existing-customer.com>

icp_soft_preferences:
  triggers:
    - recent_fundraise
    - new_hire_in_role
    - tech_installed: <tech>
  personas_to_prioritize:
    - <e.g. "Director-level over VP-level at <200 headcount">

legal:
  banned_words: []
  regulated_industry: false

created_at: <YYYY-MM-DD>
```

### 6. Save + confirm

Save to `~/cold-email-ai-skills/profiles/<business-slug>/client-profile.yaml`.
Print the yaml back to the user and ask "look right?" before ending the conversation.

## Common gotchas

- **Don't accept "SMBs" as an answer.** Ask for headcount numbers.
- **"Our ICP is anyone who needs X"** = they don't have an ICP. Push for a named-customer example.
- **Titles: always include synonyms.** "VP of Talent" without "VP of People", "Head of Talent", "Chief People Officer" will miss 60% of matches.
- **Prospeo industries: exact match required.** "Manufacturing" is not a valid Prospeo industry. "General Manufacturing" is. See `references/prospeo-industries.md`.
- **Triggers are NEVER hard filters.** If you make "must have raised in last 6 months" a hard filter, your list shrinks 20x and most of those companies are already getting pitched by everyone.

## What to do next

With `client-profile.yaml` in hand, the user's next skill is `/cold-email-starter-kit` (manual first campaign) or `/auto-research-public` (automated daily campaigns).

## Files

- `references/prospeo-industries.md` — full list of 256 valid Prospeo industry names
- `references/example-profiles/` — 3 example client-profile.yaml files (B2B SaaS, local SMB, agency)
- `scripts/scrape-website.ts` — minimal website scraper (homepage + linked pages)
