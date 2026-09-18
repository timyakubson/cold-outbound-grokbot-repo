# Personalization Sub-Agent Prompt Template

Copy this template, fill in the `<placeholders>`, and pass to the Task tool as the `prompt` parameter.

---

```
You are personalizing cold email merge fields for a batch of leads.

## Campaign context

We sell: <ONE_SENTENCE_FROM_CLIENT_PROFILE>
Our ICP: <ONE_SENTENCE_FROM_CLIENT_PROFILE>
Our offer: <THE_CTA_OR_LEAD_MAGNET>
Tone: <casual | formal | peer-to-peer>
Copy variant: <A | B | C> — <VARIANT_ANGLE_DESCRIPTION>

## Fields to generate per lead

Return these 3 fields for every lead in the batch:

**situation_line** — one sentence, max 20 words, what you noticed about their specific company based on `company_description`. Should be concrete, not generic.
Good: "You're building one of the only self-serve APM tools in the Ruby ecosystem."
Bad: "You have an interesting company."

**value_line** — one sentence, max 20 words, connecting their situation to our offer.
Good: "Most of our Ruby SaaS customers find their APM blind spots before they hit the first on-call page."
Bad: "We can help you with APM."

**cta_soft** — one sentence, max 15 words, soft ask that can be answered with Y/N.
Good: "Worth a 10-min look at what we'd flag on your stack?"
Bad: "Please schedule a meeting using this Calendly link."

## Rules

1. NEVER fabricate facts. If you're not sure, be general but not false.
2. NEVER use em dashes (—). Use periods or commas.
3. NEVER use: "leverage", "synergy", "ecosystem", "world-class", "cutting-edge", "solutions".
4. NEVER start `situation_line` with "I noticed" — overused.
5. If a lead's `company_description` is missing or <20 chars, set all 3 fields to null and add `personalization_status: "skipped_thin_data"`.
6. Do not output explanatory text outside the JSON.

## Leads

<JSON_ARRAY_OF_LEADS>

## Output

1. Build a JSON array where each element has: `lead_id`, `situation_line`, `value_line`, `cta_soft`, optional `personalization_status`.
2. Write to `/tmp/personalization-<BATCH_ID>-variant-<VARIANT>.json`.
3. Print exactly `DONE` when finished. Do not add any other output.

## Example output for one lead

{
  "lead_id": "abc123",
  "situation_line": "You're building one of the only self-serve APM tools in the Ruby ecosystem.",
  "value_line": "Most of our Ruby SaaS customers find their APM blind spots before hitting on-call.",
  "cta_soft": "Worth a 10-min look at what we'd flag on your stack?"
}
```
