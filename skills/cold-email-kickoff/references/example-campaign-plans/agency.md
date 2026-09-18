# Campaign Plan — Scale Studio Agency (example)
Generated: 2026-04-17

## Business
Scale Studio — a white-label marketing agency selling to other marketing agencies who need overflow capacity. Services: paid ads management, SEO, content production.
Website: https://scalestudio.co

## ICP
- Titles: Founder, CEO, Managing Partner, Director of Operations at marketing agencies
- Industries: Advertising Services, Marketing Services, Public Relations and Communications Services
- Headcount: 10–50 (large enough to have overflow but small enough that adding a FTE is expensive)
- Geography: US + UK + Canada + Australia
- Hard filters: agency business model (not SaaS), has named clients on website, active on LinkedIn
- Excluded: agencies <5 employees (no budget), agencies >100 employees (have in-house teams)

## Offer & Lead Magnet
- Primary CTA: "Want to white-label our team for 1 project — no long-term commitment?"
- Free hook: Free 2-hour audit of one current client account — deliverables or recommendations owned by you, pitched as your work.
- Delivery: 2-hour time-bound deliverable, NDA'd, branded as theirs.

## Top 3 Recommended Campaigns (from /campaign-strategy)
1. **Agency Capacity Pressure Signal** — target agency founders who recently posted about "hiring" or "scaling" on LinkedIn
2. **Client Roster Lookalike** — reference their named clients: "Saw you're working with {named client}. Companies like that usually need {specific overflow service}."
3. **Hiring Ad Trigger** — target agencies with open job postings for "Senior Paid Ads Manager" or similar roles. "Want to fill the gap without the 3-month ramp?"

Full strategy in: `profiles/scale-studio/campaign-strategy.md`

## Infrastructure Readiness
- [x] SMARTLEAD_API_KEY
- [x] PROSPEO_API_KEY
- [x] MILLIONVERIFIER_API_KEY
- [x] RAPIDAPI_KEY (LinkedIn engagement data)
- [x] Domains purchased (12 `.co` lookalikes)
- [ ] Inboxes warmed 2+ weeks — CURRENTLY WARMING (~day 9 of warmup). Not ready to send yet.

## Next Steps

**Not ready to launch — inboxes still warming.**

While you wait:
1. Run `/prospeo-full-export` → pull ~1,500 agency founders (titles + industries above)
2. `/icp-prompt-builder` → qualify (filter out SaaS-adjacent, too-small, too-large agencies)
3. `/list-quality-scorecard` → grade
4. Have list ready + iced in `profiles/scale-studio/list.csv`

Then:
1. Wait 5 more days for inbox warmup to complete (2 full weeks)
2. `/campaign-copywriting` → write Campaign #1 (Agency Capacity Pressure Signal)
4. `/smartlead-campaign-upload-public`
5. 21 days → `/positive-reply-scoring`

**Or:** go set up `/cold-email-weekly-rhythm` on your calendar now so you don't forget the weekly ops once live.
