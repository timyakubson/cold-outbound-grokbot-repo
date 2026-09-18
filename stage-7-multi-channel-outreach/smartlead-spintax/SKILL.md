---
name: smartlead-spintax
description: Adds Smartlead-compatible spintax to cold email sequences for deliverability. Use this skill whenever the user asks to add spintax, spin text, add variations, or improve deliverability of email copy — especially when they mention Smartlead, cold email sequences, or paste HTML email content. Also trigger when the user says "spintax", "spin", "variations", "deliverability spintax", or references adding randomized alternatives to email copy. Works with both plain text and HTML input.
---

# Smartlead Spintax Skill

Add deliverability-improving spintax to cold email sequences using Smartlead's syntax, without changing the meaning or tone of the original messaging.

## Core Concept

Spintax lets Smartlead randomly pick one option per send, so no two emails are identical. This reduces pattern detection by spam filters and improves deliverability.

**Smartlead syntax:** `{option1|option2|option3}`

Each option inside the curly braces is separated by a pipe `|`. Smartlead picks one at random per email send.

---

## Input Handling

### HTML Input (preferred workflow)

Users often paste HTML from Smartlead because copy-pasting plain text loses formatting (spaces, line breaks). When the user provides HTML:

1. Mentally parse the text content from the HTML
2. Add spintax to the text content
3. Return the full HTML with spintax baked in, preserving all HTML tags, `<br>`, `<div>`, structure exactly as received
4. Output as a code block so the user can copy-paste straight back into Smartlead

### Plain Text Input

If the user pastes plain text, add spintax and return plain text.

---

## The Golden Rule: No Broken Combinations

Every possible combination that Smartlead could randomly assemble MUST read as a natural, grammatically correct, complete sentence. This is the single most important rule.

### What "broken combo" means

When spintax options are placed near each other, every possible pairing across adjacent spintax blocks must work together. If option A from block 1 combines with option B from block 2 to form a weird or ungrammatical sentence, that's a broken combo.

### How to prevent broken combos

**Make each spintax block a self-contained phrase.** The options within one block should be interchangeable without depending on what another nearby block picks.

**BAD — dependent blocks that can break:**
```
{let me know if|would} {{employeeline}} {would be better to speak to|be a better person to chat with}
```
Problem: "would" + "would be better to speak to" = "would {{name}} would be better to speak to" — broken.

**GOOD — each option is a full standalone phrase:**
```
{let me know if {{employeeline}} would be better to speak to about this?|would {{employeeline}} be a better person to chat with about this?|should I be reaching out to {{employeeline}} about this instead?}
```
Each option is a complete sentence on its own. No cross-block dependency.

### Verification step

After adding spintax, mentally walk through every combination across adjacent blocks. If any pairing sounds off, restructure so each block is independent. When the sentence structure makes independent blocks risky, wrap the entire sentence in one spintax block with full sentence alternatives.

---

## What to Spin

Add 2-3 options per spintax block. Target these elements:

### Always spin
- **Greetings:** `{Hey|Hi}` — simple, always safe
- **Opt-out / unsubscribe lines:** These are repetitive across emails and easy to spin without tone change
- **CTAs:** Different phrasings of the same ask
- **Transition words and connectors:** "just", "also", "actually", etc.

### Spin when natural
- **Verb choices:** `{help|work with}`, `{built|made}`, `{handles|manages|tackles}`
- **Descriptors:** `{completely free|on us|100% free}`
- **Sentence-level rephrasings:** When a line can be said 2-3 different ways without changing meaning

### Never spin
- **Smartlead variables:** `{{first_name}}`, `{{company_name}}`, `{{custom_variable}}` — leave these exactly as-is
- **Signature placeholders:** `%signature%` — never touch
- **Specific data points:** Numbers, stats, brand names, product names, pricing
- **Technical terms or product descriptions** that need to be precise

---

## Tone Preservation

The spintax options must match the tone and register of the original. If the original is casual, all options should be casual. If it's direct, keep all options direct. Don't introduce formality where there was none, and don't add slang where the original was professional.

**Original tone: casual/direct**
- ✅ `{Worth a shot?|Want to give it a try?|Open to trying it out?}`
- ❌ `{Would you be amenable to a trial?|Worth a shot?}` — register mismatch

---

## Output Format

### For HTML input
Return the spintaxed HTML inside a code block:

```html
{Hey|Hi} {{first_name}}, {open to a free backlink on|interested in a free backlink from} Forbes, WSJ, or Tech Times for {{company_name}}?
<br>
<br>{We work with|We partner with} a network of over 1,200 publishers...
```

### For plain text input
Return the spintaxed text inside a code block:

```
{Hey|Hi} {{first_name}}, {open to a free backlink on|interested in a free backlink from} Forbes, WSJ, or Tech Times for {{company_name}}?
```

### After each email
State: "All combos clean." — confirming you verified every combination. If you found and fixed something, note what you changed and why.

Then ask: "Next?" or "Drop the next one." to keep the flow moving.

---

## Multi-Email Sequences

When the user is doing a full sequence, process one email at a time. After each:
1. Output the spintaxed version
2. Confirm combos are clean
3. Prompt for the next email

Keep a mental count of which email in the sequence you're on (Email 1, Email 2, etc.) so you can reference them if the user asks.

---

## Flagging Issues

If you spot something in the original copy that's awkward or could be improved (independent of spintax), flag it briefly after the spintax output. For example:

> One small flag: "does QA differently" reads a bit awkward — consider swapping to `{handles|approaches|tackles}` instead.

Keep flags minimal. Only flag things that would actually hurt the email's performance. Don't rewrite their copy unless asked.

---

## Quick Reference

| Element | Example |
|---|---|
| Syntax | `{option1\|option2\|option3}` |
| Greeting | `{Hey\|Hi}` |
| Verb swap | `{help\|work with\|partner with}` |
| Full sentence | `{Is this worth exploring?\|Want to give it a try?\|Open to a quick chat?}` |
| Opt-out | `{If this isn't relevant, just reply and I won't follow up.\|Not relevant? Just reply and I won't reach out again.}` |
| Never touch | `{{first_name}}`, `{{company_name}}`, `%signature%` |

---

## What to do next

**Launch the spintaxed copy** via `/smartlead-campaign-upload-public` — the spintax gets embedded in the `variants.yaml` body fields and renders per-recipient on send.

**Or wait:** skip this skill until your copy is final. Spintax complicates later debugging.

## Related skills

- `/campaign-copywriting` — writes the base copy this skill varies
- `/smartlead-campaign-upload-public` — launches the spintaxed campaign
