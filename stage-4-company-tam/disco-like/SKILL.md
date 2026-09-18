---
name: disco-like
description: Find lookalike companies via DiscoLike's 65M+ business domain database. Search by seed domains ("find companies like clay.com and apollo.io") or natural-language ICP text ("B2B cold email outreach"). Supports negation domains (exclude competitors/existing customers) and country filtering. Use when you already know 3-10 reference companies and want hundreds more that look like them. Outputs CSV ready for /blitz-list-builder or the email waterfall.
---

# Disco-Like

Lookalike company discovery. Give it 3-10 seed domains you know are a good fit; it returns hundreds of similar companies by domain, industry, and business characteristics. Useful for expanding from a small known-good list to a much bigger TAM without manual research.

## When to use

- You have 3-10 customer domains you love, want "more like these"
- You want to expand a small client list into a full TAM
- You have an ICP description but don't want to manually build Prospeo filters
- Competitive / adjacent-market expansion

## When NOT to use

- You need PEOPLE, not companies (use Prospeo or Blitz after this)
- Your ICP is extremely narrow or nascent (<5 seed examples exist)
- Budget is tight — DiscoLike charges per call + per record; see cost section

## Two search modes

### Mode A — Seed domains (most common)

```bash
npx tsx scripts/discover.ts --domains "clay.com,apollo.io,outreach.io" --country US --limit 500 --out lookalikes.csv
```

DiscoLike finds companies with similar characteristics (industry mix, employee count range, business type, tech stack) to your seeds.

### Mode B — Natural-language ICP

```bash
npx tsx scripts/discover.ts --text "B2B SaaS companies selling outbound sales software to RevOps teams" --country US --out lookalikes.csv
```

Uses DiscoLike's text matching. Less precise than seeds, but useful when you don't have named comparables.

### Hybrid mode

```bash
npx tsx scripts/discover.ts --domains "clay.com" --text "outbound automation" --country US --out lookalikes.csv
```

Combines both — starts from seeds, expands via text semantics.

## Negation (exclude existing customers / competitors)

```bash
npx tsx scripts/discover.ts \
  --domains "clay.com,apollo.io" \
  --negation-domains "yourcompany.com,yourbigcustomer.com" \
  --country US \
  --out lookalikes.csv
```

Always include your own domain + existing customers + known-unfit competitors. Saves enrichment cost downstream.

## Inputs

- `DISCOLIKE_API_KEY` (env) — from DiscoLike dashboard
- Either `--domains` or `--text` (at least one required)
- Optional: `--negation-domains`, `--country`, `--limit`, `--max-companies`

## Outputs

CSV with columns: `domain, company_name, industry, headcount_range, headcount, location_country, location_state, location_city, linkedin_url, description, source`

All rows have `source=discolike` so you can mix with other list-builder outputs without collisions.

## Cost

- **$0.10 per API call** + **$2.00 per 1,000 records returned**
- Default page size: 100 per call
- A 500-company discovery = ~5 calls + 500 records ≈ $1.50
- A 10,000-company discovery ≈ $10 + $20 = **$30**

Compare to Prospeo, which charges per export. DiscoLike is typically cheaper per company-discovered but more expensive per enriched contact (DiscoLike gives companies, not people).

## Required step: Qualify with /icp-prompt-builder

**This is a required step. Do not skip it.**

Before pulling 5,000 companies, run DiscoLike on a small sample (50-100), then invoke `/icp-prompt-builder`:
1. Evaluate which of the 50 are actually good ICP fits
2. Refine your ICP description / negation list based on what DiscoLike returned
3. Only then scale to 5,000+

**Why required:** DiscoLike lookalike results are only as good as your seed domains. If 80% of the first 50 are wrong, you need to change seeds, not pay to pull more. At $0.10/call + $2/1K records, a wrong-seeded 10K pull costs $20-$30 in DiscoLike fees AND cascades into wasted email-finder fees downstream. Qualifying the first 50 catches bad seeds before they become expensive.

## Recommended flow

1. `/icp-onboarding` → nail down seed companies (your best 5 customers)
2. `/disco-like --domains="seed1,seed2,..." --limit=100 --out=sample.csv` → sample run
3. `/icp-prompt-builder` → score the sample, tune ICP prompt
4. If sample quality is high, scale: `/disco-like ... --limit=5000 --out=full.csv`
5. `/blitz-list-builder --domains-file=full.csv` → find decision-makers at each
6. `/email-waterfall` → fill in emails
7. Upload to Smartlead

## API details (reference)

**Base URL:** `https://api.discolike.com/v1`

**Auth:** `x-discolike-key` header

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/count?domains=X&text=Y` | Total matching companies (before paying to pull) |
| GET | `/discover?domains=X&text=Y&country=Z&limit=100&offset=0` | Paginated lookalike results |
| GET | `/bizdata?domain=X` | Detailed data for a single domain |

**Data returned per company:**
- `domain`, `name`, `description`
- `industry_groups` (weighted dict — script takes top industry)
- `employees` (range string like "51-200")
- `address` (country, state, city)
- `social_urls` (script extracts LinkedIn company URL)

**Rate limit:** Conservative — script throttles at 5 concurrent, 10 req/sec. No 429s observed on normal runs.

## Common gotchas

- **Seed domains must be clean bare domains.** `clay.com` works, `https://clay.com/` doesn't.
- **Text mode is fuzzier than you think.** "Outbound sales" returns SaaS, agencies, consultancies — broad. Tighten with seeds.
- **No people data.** DiscoLike is company-level. Always chain with Blitz or Prospeo for contacts.
- **Non-US coverage varies.** US has deepest data. EU/APAC coverage is thinner; count may be misleading.
- **Check the count FIRST.** Before paying for 10,000 records, run `/count` to confirm the universe actually has 10,000. Many narrow ICPs top out at 500-2000.

## Scripts

- `scripts/discover.ts` — main search + CSV output
- `scripts/count.ts` — pre-check universe size before paying
- `scripts/bizdata.ts` — single-domain lookup

## What to do next

**Run `/icp-prompt-builder`** on your 50-company sample (required step above). Then either:
- `/blitz-list-builder` to find owner contacts at each filtered domain, OR
- `/list-quality-scorecard` directly if this is companies-only and you'll enrich another way

**Or wait:** if the 50-sample ICP fit was poor (<40% matches), don't scale. Change your seed domains and re-run with better inputs.

## Related skills

- `/icp-onboarding` — defines the seed domains you'll use
- `/icp-prompt-builder` — quality-check the first 50 results before scaling
- `/blitz-list-builder` — chain to find contacts at each discovered company
- `/email-waterfall` — fill missing emails after Blitz
- `/cold-email-starter-kit` → `06-list-building-prospeo.md` for broader list-building patterns
