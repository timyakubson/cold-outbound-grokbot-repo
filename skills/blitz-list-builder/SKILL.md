---
name: blitz-list-builder
description: Use the Blitz API to find decision-makers at specific companies when you already have a list of company domains. Best for SMB owner-finding, domain-to-people lookup, or supplementing Prospeo results. Outputs a CSV you can feed to the email-waterfall or directly to /cold-email-starter-kit for Smartlead upload. Use when your targeting is company-first (not title-first).
---

# Blitz List Builder

Prospeo is title-first: "all VPs of Marketing in B2B SaaS." Blitz is domain-first: "for each of these 500 restaurant domains, find the owner."

If you already know the target companies (from Google Maps, a CSV of competitors, or a manually-curated list), Blitz finds the people for you.

## When to use Blitz vs Prospeo

| Your situation | Use |
|---|---|
| "I have 5,000 domains, find the owners" | Blitz |
| "Find all CFOs at US SaaS companies 100-500 employees" | Prospeo |
| "I need to supplement Prospeo results with additional contacts at the same companies" | Blitz |
| "I want the widest net possible in a vertical" | Prospeo |
| "I'm targeting specific named accounts (ABM)" | Blitz |

Often: use Prospeo to build the initial list, then Blitz to add 1-2 more contacts per company.

## Prerequisites

- Blitz API key (env: `BLITZ_API_KEY`) — sign up at their website
- List of target company domains (CSV with a `company_domain` column, or one domain per line)

## Inputs

- `--domains-file=<path>` — CSV or txt with company domains (one per line, or a column named `company_domain`)
- `--titles=<csv>` — comma-separated title keywords to filter (default: `owner,founder,ceo,president,cto,vp`)
- `--out=<path>` — CSV output path

## Outputs

CSV with columns: `company_domain, first_name, last_name, job_title, linkedin_url, email, email_source, company_name, company_industry, company_headcount, company_phone`

Email will be populated when Blitz returns one. Use `/email-waterfall` skill on the output to fill in missing emails via Prospeo/ZenRows/etc.

## Usage

```bash
export BLITZ_API_KEY=xxx

# Pull owner/founder/CEO contacts for 5000 SMB domains
npx tsx scripts/find-contacts.ts \
  --domains-file=restaurants.csv \
  --titles=owner,founder,ceo,general-manager \
  --out=restaurant-owners.csv

# Domain-first discovery with custom title match
npx tsx scripts/find-contacts.ts \
  --domains-file=saas-companies.txt \
  --titles=vp-marketing,head-of-growth,cmo,director-marketing \
  --out=saas-marketers.csv
```

## API overview

Blitz has two main endpoints we use:

**Company enrichment** (find employees):
```
POST {BLITZ_BASE_URL}/api/enrichment/company
Body: { "domain": "acme.com" }
Response: { employees: [{ first_name, last_name, title, linkedin_url, email }], company: { name, industry, headcount, phone } }
```

**Email enrichment** (find email for a LinkedIn URL):
```
POST {BLITZ_BASE_URL}/api/enrichment/email
Body: { "linkedin_profile_url": "https://linkedin.com/in/..." }
Response: { email: "...", status: "verified" }
```

## Rate limiting

The script throttles at **30 requests/second with concurrency 10**. This matches Blitz's published limits. If you see 429s, lower the concurrency flag.

## Hit rate expectations

Rough benchmarks (from real campaigns):
- **SMBs (restaurants, clinics, salons):** 70-80% contact-found rate, 40-60% email-found
- **B2B tech (10-500 employees):** 80-90% contact-found, 50-70% email-found
- **Enterprise (>1000 employees):** 90%+ contact-found, but filtering for the RIGHT person matters more than the found-rate
- **Solo operators / micro-businesses:** 30-50% — often no public LinkedIn

## Title filtering — write specific keywords

Default keywords (`owner, founder, ceo, president, cto, vp`) are broad. Narrow them per campaign:

```bash
# Restaurants
--titles=owner,operator,general-manager

# SaaS RevOps
--titles=revops,revenue-operations,vp-sales,director-sales

# Dental practices
--titles=dentist,owner,practice-manager

# Law firms
--titles=partner,managing-partner,principal
```

The script does case-insensitive substring match. "vp" matches "VP Sales" but also "VP Product" — narrow further if that's too loose.

## Common gotchas

- **Domain must be just the bare domain.** Blitz wants `acme.com`, not `https://acme.com/` or `sub.acme.com`.
- **Huge companies return truncated employee lists.** Blitz caps at ~50-100 employees per domain. For enterprise-heavy lists, use Prospeo or LinkedIn search instead.
- **Stale LinkedIn data.** Blitz's cache can be 3-12 months old. Job titles may have changed. Validate with the email waterfall.
- **No email returned ≠ person unreachable.** 40% of hits have no email. Feed them to `/email-waterfall` — it'll try Prospeo + ZenRows.
- **Rate-limit errors.** 429 = you hit the cap. Script retries with exponential backoff, but long bursts still fail.

## Required step: Qualify with /icp-prompt-builder

**This is a required step. Do not skip it.**

Before pulling more than 500 companies' worth of contacts, sample ~50 and run `/icp-prompt-builder` on them:

1. Evaluates the first 10 with an AI qualification prompt
2. You give corrections ("this one should be NO because they're a competitor")
3. Refines the prompt, runs next 10
4. Stops after 2 rounds with zero corrections — prompt is tuned
5. Apply the tuned prompt to the remaining leads to filter before paying for email enrichment

**Why it's required:** Blitz contact-finding is cheap, but email enrichment downstream is not. A typical 5,000-contact run costs $150+ in email-finding API calls. If 40% of your list is wrong-fit, you burn ~$60 finding emails at companies that will never convert. The ICP prompt builder takes 10-15 min and saves that.

**How to skip safely:** you can't. If you're sure your list is already perfectly qualified (e.g., it came from a curated seed list of named accounts you want to pitch), run `/icp-prompt-builder` anyway on 10 of them and confirm your existing qualification matches — the prompt builder becomes a sanity check instead of a filter.

## Cost

Per Blitz pricing (check their current rates):
- Company enrichment: ~$0.02-0.05 per domain
- Email enrichment: ~$0.05-0.10 per email

5,000 domains = ~$150 for contacts alone. Plan your budget.

## Output → next step

Once you have the CSV, the typical flow:

1. **Deduplicate** — remove duplicate emails, duplicate LinkedIn URLs
2. **Filter** — drop rows where `job_title` doesn't cleanly match your ICP
3. **Fill missing emails** — run `/email-waterfall` on rows with empty `email`
4. **Validate** — run MillionVerifier on all emails (see `/email-waterfall` script)
5. **Upload** — pass to Smartlead via `/cold-email-starter-kit` script `smartlead-add-leads.ts`

## Scripts

- `scripts/find-contacts.ts` — main batch enrichment script

## What to do next

**Run `/email-waterfall`** to fill in emails for rows Blitz didn't return. Then `/list-quality-scorecard` to grade the final list.

After the scorecard, proceed to `/campaign-copywriting` → `/smartlead-campaign-upload-public`.

**Or wait:** if the required `/icp-prompt-builder` step (above) showed <40% qualification rate, your source list of domains is off. Fix that before spending more Blitz credits.

## Related skills

- `/icp-prompt-builder` — qualify the contacts this skill returns BEFORE running email waterfall
- `/prospeo-full-export` — the title-first alternative
- `/google-maps-list-builder` — for local-business domain lists
- `/disco-like` — lookalike companies from seed domains
- `/email-waterfall` — when Blitz doesn't return an email
- `/cold-email-starter-kit` → `06-list-building-prospeo.md` for broader list-building context
