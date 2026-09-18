---
name: spam-word-checker
description: >
  Always-on spam and deliverability guardrails for cold email copy. Apply these rules whenever
  writing, reviewing, or QA-ing subject lines, openers, follow-ups, CTAs, or any cold outreach
  copy. Trigger on phrases like "check this for spam", "spam word check", "deliverability review",
  "QA this copy", "flag banned words", "check subject line", "is this safe to send", "scan for
  spam triggers", or any time cold email copy is being generated or reviewed. Also trigger
  automatically as a background rule whenever the campaign-copywriting or cold-email-copywriting
  skill is active -- these guardrails apply to EVERY piece of outbound copy generated, even if
  the user does not explicitly ask for a check.
---

# Spam Word Checker

Always-on spam and deliverability rules. Apply to every subject line, opener, second line, follow-up, and CTA generated or reviewed.

---

## When These Rules Apply

- Subject lines, openers, second lines, follow-ups, CTAs
- Any cold outreach copy being written or QA'd
- If a deliverability checker or review flags a word/phrase, treat it as banned going forward unless user explicitly approves an exception
- When in doubt, choose the lower-hype rewrite

---

## Banned Single Words

Do not use any of the following standalone or as part of a compound word/phrase:

`get`, `bank`, `credit`, `access`, `open`, `compare`, `problem`, `now`, `billing`, `deal`, `finance`, `financial`, `claims`, `insurance`, `mortgage`, `soon`, `new`, `performance`, `freedom`, `home`, `sales`, `medical`, `urgent`, `life`, `marketing`, `investment`, `diagnostics`, `friend`, `cash`, `invoice`, `extra`, `purchase`

**Nuance:** Punctuation, hyphens, or splits do not make a banned token safe. Treat close variants as banned when the root token is still obvious:
- `cash-cycle` → still `cash` → banned
- `invoice-line` → still `invoice` → banned
- `extra-room` → still `extra` → banned
- `purchase-cycle` → still `purchase` → banned

---

## Banned Short Phrases

`off chance`, `one time`, `all good`, `following up here`, `last note from me here`, `great fit`, `bumping this once`, `just following up once`, `circle back`, `one more quick follow-up`, `keep this open`, `compare notes`, `compare notes live`, `appreciate the reply`

---

## High-Risk Promotional / Pressure Wording (Banned)

`$$$`, `50% off`, `100% guaranteed`, `100% free`, `100% off`, `100% satisfied`, `access now`, `act fast`, `act immediately`, `act now`, `action required`, `affordable deal`, `amazing`, `amazing deal`, `amazing offer`, `apply here`, `apply now`, `avoid bankruptcy`, `bargain`, `best bargain`, `best deal`, `best offer`, `best price`, `best rates`, `big profit`, `bonus`, `buy now`, `buy today`, `call now`, `can't live without`, `cash bonus`, `cash out`, `claim now`, `claim your discount`, `click`, `click below`, `click here`, `click this link`, `contact us immediately`, `deal ending soon`, `discount`, `don't delete`, `double your money`, `double your wealth`, `drastically reduced`, `earn`, `earn cash`, `earn extra income`, `earn money`, `easy income`, `exclusive deal`, `expires today`, `extra cash`, `extra income`, `fantastic`, `fantastic offer`, `fast cash`, `final call`, `for free`, `free access`, `free consultation`, `free gift`, `free membership`, `free money`, `free quote`, `free trial`, `full refund`, `get it now`, `get out of debt`, `get started now`, `giveaway`, `great news`, `guaranteed deposit`, `guaranteed results`, `hurry up`, `important information`, `immediately`, `increase revenue`, `increase sales`, `incredible deal`, `instant earnings`, `instant income`, `instant savings`, `investment advice`, `join millions`, `limited time`, `lowest price`, `make money`, `million dollars`, `money-back guarantee`, `must read`, `no catch`, `no cost`, `no obligation`, `no strings attached`, `once in a lifetime`, `only $`, `only available here`, `order now`, `order today`, `please read`, `price protection`, `profits`, `promise`, `pure profit`, `quote`, `risk-free`, `satisfaction guaranteed`, `save $`, `save big money`, `save up to`, `sign up free`, `special invitation`, `special offer`, `special promotion`, `supplies are limited`, `take action now`, `the best`, `this won't last`, `thousands`, `time limited`, `today`, `top urgent`, `trial`, `unbeatable offer`, `unbelievable`, `unlimited`, `urgent`, `what are you waiting for?`, `while supplies last`, `why pay more?`, `will not believe`, `winner announced`, `wonderful`, `you are a winner`, `you will not believe your eyes`

---

## Phishing-Style / Security-Warning Language (Banned)

`access your account`, `account update`, `activate now`, `change password`, `click to verify`, `confirm your details`, `confidential information`, `data breach`, `download now`, `final notice`, `important update`, `immediate action required`, `install now`, `last warning`, `log in now`, `new login detected`, `password reset`, `payment details needed`, `phishing alert`, `security breach`, `security update`, `update account`, `verify identity`, `warning message`

---

## Irrelevant Blacklisted Categories (Never Appear in Copy)

`100% natural`, `adult content`, `bet now`, `blackjack`, `casino bonus`, `cure for`, `diet pill`, `doctor recommended`, `fat burner`, `fast weight loss`, `free chips`, `free spins`, `gamble online`, `guaranteed weight loss`, `jackpot`, `lottery winner`, `medical breakthrough`, `miracle cure`, `natural remedy`, `no prescription needed`, `online betting`, `online casino`, `online pharmacy`, `pain relief`, `poker tournament`, `prescription drugs`, `reverse aging`, `risk-free bet`, `safe and effective`, `scientifically proven`, `secret formula`, `slots jackpot`, `spin to win`, `vip offer`, `weight loss`, `winning numbers`, `xxx`

---

## Formatting & Style Bans

- No em dashes
- No ALL CAPS
- No multiple exclamation marks
- No greeting prefix before first name (no Hi, Hello, Hey)
- No third-person company references (`[Company] offers`, `[Company] helps`)
- No fake urgency, misleading subject lines, excessive links, or promotional formatting

---

## Unsubscribe / Closeout Line Rules

Never write an unsubscribe line that promises to stop following up based on silence. We DO follow up — that's the whole point of sequences. Silence-based promises are misleading and fail to match actual behavior.

**Banned patterns (silence = we stop):**
- `I will take silence as a no`
- `read no reply as a pass`
- `assume no response means no interest`
- `If I don't hear back, I will leave it there / let this one go / leave you alone`
- `I am happy to stay out of the way` (if implied by context)
- Any construction where the user doing nothing = we stop sending

**Allowed patterns (explicit user action = we stop):**
- `A reply of 'no' / 'not for us' / 'pass' is enough and I'll step out of your inbox` (action-conditional)
- `Just say the word and I'll stop` (asks for action)
- `A one-word reply works fine if you'd rather I stopped` (asks for action)
- `Feel free to ignore this` (permission, no promise)
- `Happy to try back later when timing makes more sense` (defers, doesn't stop)
- `If this isn't the right angle, tell me what is` (invites pivot)
- `If I misjudged the fit, I'd rather know than guess` (asks for clarification)

Rule of thumb: **the user has to do something explicit for the sequence to stop**. Silence keeps the cadence running.

---

## Safe Replacement Patterns

| Banned / Risky | Safe Replacement |
|---|---|
| `free consultation` | `open to a short conversation` |
| `special offer` | `what we're seeing in the market` |
| `act now` | `if relevant, happy to send details` |
| `guaranteed results` | `this may be relevant depending on your situation` |
| `click here` | `let me know and I can send it over` |
| `limited time` | `not sure if this is timely for you` |
| `increase revenue` | precise business outcome (e.g. `help support liquidity`) |

---

## Rewriting Logic

- Rewrite hype into plain, observational language
- Replace pressure with permission
- Replace promotional wording with specific business language
- If a line sounds like an ad, coupon, scam, or phishing message → rewrite it
- If a bump sounds filler-heavy or vague → replace with a direct next-step question or clear closeout line
- If a value line uses fuzzy wording (`tight`, `fit`, `access`, `problem`) → rewrite so the operational meaning is explicit
- If a reply acknowledgement sounds low-status → remove it and go straight to the next useful question
- If a sentence sounds AI-polished → simplify until it reads like a person speaking plainly

---

## Company Name Handling

If a banned word appears inside a company name used in copy:
1. Do not drop the company reference entirely if the name is still needed
2. Rewrite the displayed name so the banned token is removed from standalone form
3. Priority: remove the token if the remaining name still reads clearly; only abbreviate or compress when needed

Examples:
- `Access Brand Communications` → `AB Communications`
- `Calcon Mutual Mortgage` → `Calcon Mutual`
- `Buckeye Insurance` → `Buckeye`
- `Coming Soon New York` → `Coming NY`

---

## Final QA Checklist

Before approving any copy:

- [ ] Scan subject line for spam-trigger wording
- [ ] Scan body for banned or high-risk wording
- [ ] Rewrite any hype-heavy or pressure-heavy line into plain language
- [ ] Remove fake urgency
- [ ] Confirm email sounds like a credible real person, not a promotion

---

## What to do next

**If flags cleared:** run `/smartlead-spintax` before upload, then launch via `/smartlead-campaign-upload-public`.

**If flags fired:** back to `/campaign-copywriting` to rewrite the flagged lines. Re-run this check after.

**Or wait:** this skill auto-triggers on every copy draft — there's no standalone "next". Continue whatever copy work you were doing.

## Related skills

- `/campaign-copywriting` — produces the copy this skill screens
