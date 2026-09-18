# Campaign Plan — Delivery Margin Pro (example)
Generated: 2026-04-17

## Business
Delivery Margin Pro — a SaaS that helps multi-location restaurants recover 15–25% of DoorDash/UberEats fees via automated contract renegotiation + rate audits.
Website: https://deliverymarginpro.com

## ICP
- Restaurant owners / operators, 2-10 locations
- Industries: Restaurants, Food and Beverage Services
- Headcount: 5–200 (single restaurant ~15, multi-location ~100)
- Geography: US only (top 50 metros)
- Hard filters: on DoorDash + UberEats, 4+ star rating, 100+ Google reviews
- Excluded industries: Corporate chains (decisions made at HQ, not location), single-location (too small for the product)

## Offer & Lead Magnet
- Primary CTA: "Want a free 5-minute audit of your DoorDash + UberEats fees?"
- Free hook: We audit your current delivery contracts and send a 1-page report showing recoverable fees. Avg finding: $4K–$20K/month.
- Delivery: upload their two most recent DoorDash invoices, we return the report in 48 hours.

## Top 3 Recommended Campaigns (from /campaign-strategy)
1. **Google Review Signal** — reference a specific complaint from their public Google reviews if it mentions pricing/fees/delivery. Shows research.
2. **Metro Benchmark Report** — "Here's what other {city} restaurants are paying in delivery fees vs. what you're probably paying."
3. **Multi-Location Consolidation** — target operators with 3+ locations. Value prop: "One contract renegotiation across all your locations = bigger win."

Full strategy in: `profiles/delivery-margin-pro/campaign-strategy.md`

## Infrastructure Readiness
- [x] SMARTLEAD_API_KEY in .env
- [ ] PROSPEO_API_KEY (NOT NEEDED — using Google Maps)
- [x] MILLIONVERIFIER_API_KEY in .env
- [x] RAPIDAPI_KEY in .env (for Google Maps scraping)
- [x] Domains purchased (15 `.com` lookalikes)
- [x] Inboxes warmed 2+ weeks (30 inboxes)
- [x] BLITZ_API_KEY in .env (for owner contact finding)

## Next Steps

Infrastructure ready.

Recommended flow:
1. `/google-maps-list-builder` → scrape 1,000 multi-location restaurants in top 50 metros with 100+ reviews + 4+ stars
2. `/icp-prompt-builder` (required) → qualify a 50-sample (filter out chains, single-locations, 3-star places)
3. `/blitz-list-builder` → find owner contacts at each remaining restaurant
4. `/email-waterfall` → fill missing emails
5. `/list-quality-scorecard` → grade
6. `/campaign-copywriting` → write Campaign #1 (Google Review Signal)
8. `/smartlead-campaign-upload-public` → DRAFT, review, Start manually
9. 21 days → `/positive-reply-scoring`
