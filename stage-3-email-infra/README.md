# Stage 3 — Email infrastructure

Before you buy a single domain or mailbox, size the setup first.

**Manual step, do this before running `zapmail-domain-setup-public`:**

Go to [Primeforge's mailbox calculator](https://primeforge.ai/?via=timka)
and plug in your monthly contact volume, emails per sequence, and mailboxes
per domain. It'll tell you exactly how many domains and inboxes you actually
need, so you're not guessing or over/under-buying.

*(Heads up: that's my affiliate link, disclosing it here same as I do on
camera.)*

Want to see it in action first? Here's the full walkthrough:
https://www.youtube.com/watch?v=TgZ0V1gMz-c&t=5s

Once you've got your numbers from the calculator, hand them to
`zapmail-domain-setup-public/` below, that skill does the actual domain
purchase (via DynaDot) and mailbox provisioning (via Zap Mail) based on the
count you just calculated.
