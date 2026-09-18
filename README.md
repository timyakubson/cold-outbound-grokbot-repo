# Cold Outbound Grok Bot Repo

A Grok Bot / Codex skill library for building a cold outbound GTM system from
zero, mapped to the 8-step build order taught in the companion video.

**Forked and adapted from** [`coldoutboundskills`](https://github.com/growthenginenowoslawski/coldoutboundskills)
by **Eric Nowoslawski** (GrowthEngineX), MIT licensed. This repo trims his 30
skills + 19 signal playbooks down to the ~24 that map directly onto the build
below, adds a new segment-aware list-building router, and adapts the sending
layer from SmartLead-only to a multi-channel setup. Full credit and the
original source are in the link above; the LICENSE file here is unchanged
from his.

## The 8-step build

| Step | What you build | Skills |
|---|---|---|
| 1. Connect your tools | Not a skill, a connection step (CRM, GitHub, email, LinkedIn, calendar, CompanyEnrich, Lemlist) | — |
| 2. Data intake | Onboarding bot that interviews you | `icp-onboarding` |
| 3. Company TAM | Company-list bot, **CompanyEnrich** plugs in here for lookalike TAM expansion | `list-builder`, `list-expander`, `disco-like`, `list-builder-router` |
| 4. People TAM | Prospect bot, decision-maker enrichment | `prospeo-full-export`, `prospeo-search-api`, `blitz-list-builder`, `google-maps-list-builder`, `list-builder-router` |
| 5. Messaging & copywriting | Copywriter bot | `campaign-strategy`, `campaign-copywriting`, `personalization-subagent-pattern` |
| 6. Multi-channel outreach | Outreach bot, **Lemlist** plugs in here (email, LinkedIn, SMS, WhatsApp) | `smartlead-api`, `smartlead-campaign-upload-public`, `smartlead-inbox-manager`, `smartlead-spintax` *(being adapted from SmartLead to the Lemlist API on camera, kept here as the reference template)* |
| 7. Campaign creation, launch & QA | QA / deliverability bot | `spam-word-checker`, `list-quality-scorecard`, `email-deliverability-audit`, `deliverability-incident-response` |
| 8. Turn one-off into a skill | Not a new bot, screen-record steps 2-7 once and save as a reusable skill | `auto-research-public`, `positive-reply-scoring`, `cold-email-weekly-rhythm` |

Plus `cold-email-kickoff` and `zapmail-domain-setup-public` as the orchestrator
and infra setup skills, carried over from the original repo unchanged.

## Sponsor integrations, and why they're placed where they are

- **CompanyEnrich** (Step 3): company-level lookalikes and TAM expansion.
  Chosen for this step specifically because it wins on coverage (67.6%) and
  data depth (17.9/27 fields) in independent benchmarks, not a generic mention.
- **Lemlist** (Step 6): the only tool in this stack that actually covers all
  four promised channels (email, LinkedIn, SMS, WhatsApp). Its own lookalike
  finder is used inline during outreach, not as the primary list-build step,
  so it doesn't overlap with CompanyEnrich's job in Step 3.

See `skills/list-builder-router/SKILL.md` for the full fallback logic,
including StoreLeads (e-commerce) and Outscraper (local business).

## Status

Built alongside the companion video. `campaign-copywriting` is carried over
close to untouched since it's provider-agnostic and didn't need a swap.
