# Campaign Plan — Acme Analytics (example)
Generated: 2026-04-17

## Business
Acme Analytics — a product-analytics platform for B2B SaaS companies (50-500 employees). Helps product + growth teams attribute feature usage to revenue.
Website: https://acmeanalytics.com

## ICP
- Titles: VP Product, Head of Product, VP Growth, Head of Analytics, Director of Product Analytics
- Industries: Software Development, Technology, Information and Internet, Financial Services
- Headcount: 50–500
- Geography: US + Canada
- Hard filters: B2B only (not B2C), has a product team of ≥3, raised Series A+
- Excluded industries: Non-profit Organizations, Religious Institutions, Government Administration

## Offer & Lead Magnet
- Primary CTA: "Want a free 30-min product analytics audit?"
- Free hook: 30-minute audit of their current analytics stack — identifies 3 specific gaps + a prioritized fix list
- Delivery: async Loom recording sent within 48 hours, 1-page written summary

## Top 3 Recommended Campaigns (from /campaign-strategy)
1. **Analytics Stack Audit** — offer a free audit as the front-end. Value prop: "Save time vs. running this audit yourself."
2. **New VP Product Welcome** — target VPs/Heads of Product who started <90 days ago. They're hunting for quick wins.
3. **Mixpanel/Amplitude Competitive Switch** — target companies currently using Mixpanel or Amplitude (detected via BuiltWith). Value prop: "Save money consolidating."

Full strategy in: `profiles/acme-analytics/campaign-strategy.md`

## Infrastructure Readiness
- [x] SMARTLEAD_API_KEY in .env
- [x] PROSPEO_API_KEY in .env
- [x] MILLIONVERIFIER_API_KEY in .env
- [x] Domains purchased (20 `.com` lookalikes)
- [x] Inboxes warmed 2+ weeks (40 inboxes tagged `active`)

## Next Steps

Infrastructure ready — time to build the list.

Recommended: `/prospeo-full-export` (title-first, best fit for VP Product ICP).

Flow from here:
1. `/prospeo-full-export` → pull ~2,000 VP/Head of Product leads in Software Development industry
2. `/icp-prompt-builder` (required step inside Prospeo skill) → qualify on a 50-sample before scaling
3. `/list-quality-scorecard` → grade the filtered list
4. `/campaign-copywriting` → write the "Analytics Stack Audit" campaign (Campaign #1 from strategy)
6. `/smartlead-campaign-upload-public` → DRAFT upload, review in UI, hit Start
7. Wait 21 days, then `/positive-reply-scoring`
