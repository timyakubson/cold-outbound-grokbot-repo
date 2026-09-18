# list-builder-router

Segment-aware router for Step 3 (Company TAM) and Step 4 (People TAM). Reads the
segment type off `client-profile.yaml` (produced by `icp-onboarding`) and picks
the right data source instead of running one fixed provider for every ICP.

## Routing table

| Segment / need | Provider | Why |
|---|---|---|
| Company-level lookalikes, LinkedIn data, firmographic depth | **CompanyEnrich** | Similar Companies API for TAM expansion; wins on coverage and field depth in independent benchmarks |
| Person-level database, quick lookalike expansion during outreach | **Lemlist** | Built-in 600M+ B2B database + AI Lookalike Finder (LinkedIn URL in, similar profiles out), used inline while sending, not as the primary list-build step |
| E-commerce companies | **StoreLeads** | Purpose-built for identifying and enriching e-commerce storefronts |
| Local / brick-and-mortar business leads | **Outscraper** | Google Maps / local business data at volume |
| Everything else / no clean provider match | **Exa.ai** | General-purpose web search and retrieval, catch-all fallback |

## Behavior

1. Read `segment_type` from `client-profile.yaml`.
2. Match against the table above.
3. If no confident match, fall back to Exa.ai and flag the record for manual review.
4. Hand the resulting company/people list to `list-builder` / `list-expander` /
   `disco-like` for enrichment and lookalike expansion as normal.

## Status

Net-new skill, not present in the upstream repo this was forked from. Built for
the Grok Bot GTM course; CompanyEnrich and Lemlist integrations are sponsor
placements, both chosen because they do real, distinct work in the pipeline
(see routing table above), not interchangeable mentions.
