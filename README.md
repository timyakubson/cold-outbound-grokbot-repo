# Cold Outbound Grok Bot Repo

A Grok Bot / Codex skill library for building a cold outbound GTM system from
zero, staged into folders that map onto the companion video's build order.

**Forked and adapted from** [`coldoutboundskills`](https://github.com/growthenginenowoslawski/coldoutboundskills)
by **Eric Nowoslawski** (GrowthEngineX), MIT licensed. This repo trims his 30
skills + 19 signal playbooks down to the ones that map onto the build below,
adds a new segment-aware list-building router, adapts the sending layer from
SmartLead-only to a multi-channel setup, and adds a manual infrastructure-
sizing step before any domains get bought. Full credit and the original
source are in the link above; the LICENSE file here is unchanged from his.

## How to actually use this repo (don't build the bots by hand)

Connect Grok Bot to this repo (Stage 1), then message your Taskmaster bot
something like:

> "Read every `stage-N` folder in this repo in order:
> https://github.com/timyakubson/cold-outbound-grokbot-repo. For each stage,
> create one bot named after that stage, load it with the skill file(s)
> inside that folder, and write its description so it hands off its output
> to the bot for the next stage."

Grok Bot reads the staged folders and builds the whole multi-bot team itself,
already wired to hand off to each other in order. You don't create every bot
one at a time, you paste one prompt.

## Video steps vs. repo folders

The companion video walks through 12 numbered steps. The first 4 are pre-
flight setup that don't produce a skill file of their own, so they're
compressed into Stage 1 here rather than getting 4 separate folders. From
there, video step numbers run 3 ahead of the repo's stage numbers.

| Video step | What happens | Repo folder |
|---|---|---|
| 1. Connecting Tools | Connect Taskmaster to CRM, email, LinkedIn, calendar, CompanyEnrich, Lemlist | `stage-1-connecting-tools` |
| 2. Create Taskmaster | Create the one bot you build by hand, with its delegator prompt | `stage-1-connecting-tools` |
| 3. Grab The Repo | Fork this repo, connect it, paste the one build prompt | `stage-1-connecting-tools` |
| 4. Download The Mobile App | Grok Bot on your phone for check-ins | `stage-1-connecting-tools` |
| 5. Data Intake | Onboarding bot interviews you | `stage-2-data-intake` |
| 6. Email Infra | **Manual step first**: size your setup with [Primeforge's mailbox calculator](https://primeforge.ai/?via=timka), then provision | `stage-3-email-infra` |
| 7. Company TAM | **CompanyEnrich** plugs in here for lookalike TAM expansion | `stage-4-company-tam` |
| 8. People TAM | Decision-maker enrichment | `stage-5-people-tam` |
| 9. Copywriting | Copywriter bot | `stage-6-copywriting` |
| 10. Multi-Channel Outreach | **Lemlist** plugs in here (email, LinkedIn, SMS, WhatsApp) | `stage-7-multi-channel-outreach` |
| 11. QA | QA / deliverability bot | `stage-8-qa` |
| 12. Turn One-Off Into a Skill | Screen-record the whole run once, save it as a reusable skill | `stage-9-turn-into-a-skill` |

## Sponsor / partner integrations, and why they're placed where they are

- **Primeforge** (video Step 6 / `stage-3-email-infra`): affiliate link,
  disclosed on camera and in that stage's README. Used for its mailbox
  calculator, sizing your domain/inbox count before you spend anything, not
  just a mention.
- **CompanyEnrich** (video Step 7 / `stage-4-company-tam`): company-level
  lookalikes and TAM expansion. Wins on coverage (67.6%) and data depth
  (17.9/27 fields) in independent benchmarks, which is why it's the default
  here rather than a generic plug.
- **Lemlist** (video Step 10 / `stage-7-multi-channel-outreach`): the only
  tool in this stack that actually covers all four promised channels (email,
  LinkedIn, SMS, WhatsApp). Its own lookalike finder is used inline during
  outreach, not as the primary list-build step, so it doesn't overlap with
  CompanyEnrich's job in Stage 4.

See `stage-4-company-tam/list-builder-router/SKILL.md` for the full
provider-routing logic, including StoreLeads (e-commerce) and Outscraper
(local business) as fallbacks.

## Status

Built alongside the companion video. `campaign-copywriting` is carried over
close to untouched since it's provider-agnostic and didn't need a swap.
