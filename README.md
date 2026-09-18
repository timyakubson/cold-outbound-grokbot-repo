# Cold Outbound Grok Bot Repo

A Grok Bot / Codex skill library for building a cold outbound GTM system from
zero, staged into 9 numbered folders that map directly onto the companion
video's build order.

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
already wired to hand off to each other in order. You don't create 9 bots
one at a time, you paste one prompt.

## The 9-stage build

| Stage | What you build | Contents |
|---|---|---|
| 1. Connecting tools | Connect Taskmaster to CRM, GitHub, email, LinkedIn, calendar, CompanyEnrich, Lemlist | `cold-email-kickoff` (Taskmaster's core skill) |
| 2. Data intake | Onboarding bot that interviews you | `icp-onboarding` |
| 3. Email infra | **Manual step first**: size your setup with [Primeforge's mailbox calculator](https://primeforge.ai/?via=timka) before buying anything, then provision | `zapmail-domain-setup-public` |
| 4. Company TAM | Company-list bot. **CompanyEnrich** plugs in here for lookalike TAM expansion | `list-builder`, `list-expander`, `disco-like`, `list-builder-router` |
| 5. People TAM | Prospect bot, decision-maker enrichment | `prospeo-full-export`, `prospeo-search-api`, `blitz-list-builder`, `google-maps-list-builder` |
| 6. Copywriting | Copywriter bot | `campaign-strategy`, `campaign-copywriting`, `personalization-subagent-pattern` |
| 7. Multi-channel outreach | Outreach bot. **Lemlist** plugs in here (email, LinkedIn, SMS, WhatsApp) | `smartlead-api`, `smartlead-campaign-upload-public`, `smartlead-inbox-manager`, `smartlead-spintax` *(templates being adapted from SmartLead to the Lemlist API on camera)* |
| 8. QA | QA / deliverability bot | `spam-word-checker`, `list-quality-scorecard`, `email-deliverability-audit`, `deliverability-incident-response` |
| 9. Turn one-off into a skill | Not a new bot, screen-record stages 2-8 once and save as a reusable skill | `auto-research-public`, `positive-reply-scoring`, `cold-email-weekly-rhythm` |

## Sponsor / partner integrations, and why they're placed where they are

- **Primeforge** (Stage 3): affiliate link, disclosed on camera and in
  `stage-3-email-infra/README.md`. Used for its mailbox calculator, sizing
  your domain/inbox count before you spend anything, not just a mention.
- **CompanyEnrich** (Stage 4): company-level lookalikes and TAM expansion.
  Wins on coverage (67.6%) and data depth (17.9/27 fields) in independent
  benchmarks, which is why it's the Stage 4 default rather than a generic
  plug.
- **Lemlist** (Stage 7): the only tool in this stack that actually covers all
  four promised channels (email, LinkedIn, SMS, WhatsApp). Its own lookalike
  finder is used inline during outreach, not as the primary list-build step,
  so it doesn't overlap with CompanyEnrich's job in Stage 4.

See `stage-4-company-tam/list-builder-router/SKILL.md` for the full
provider-routing logic, including StoreLeads (e-commerce) and Outscraper
(local business) as fallbacks.

## Status

Built alongside the companion video. `campaign-copywriting` is carried over
close to untouched since it's provider-agnostic and didn't need a swap.
