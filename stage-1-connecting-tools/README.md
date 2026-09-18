# Stage 1 — Connecting tools

Not a skill, a pre-flight checklist. This is video Steps 1-4 compressed into
one repo stage, since none of them produce a skill file of their own, they
just get you ready to start Stage 2.

## Step 1 — Connect your tools

Plug Taskmaster into:

- Your CRM
- Email (Gmail/Google Workspace or your sending domain provider)
- LinkedIn
- Calendar
- CompanyEnrich (used in Stage 4)
- Lemlist (used in Stage 7)

Use Grok Bot's plugins panel + secure gateway for anything needing an API
key, never paste a key directly into a chat message.

## Step 2 — Create Taskmaster

Create your first bot. Name it **Taskmaster**. Use this as its
description/prompt:

> "You are the central point of contact for our lead generation operation.
> You do not execute tasks yourself, you delegate to the appropriate
> specialist bot for each stage. Confirm task completion with the user and
> summarize what happened."

This is the only bot you create manually, everything after Stage 1 gets
built by Taskmaster itself (see below).

## Step 3 — Grab the repo

Fork [`cold-outbound-grokbot-repo`](https://github.com/timyakubson/cold-outbound-grokbot-repo)
into your own GitHub account, then connect Taskmaster to your fork via the
GitHub plugin.

Once connected, message Taskmaster:

> "Read every `stage-N` folder in this repo in order:
> [your fork's URL]. For each stage, create one bot named after that stage,
> load it with the skill file(s) inside that folder, and write its
> description so it hands off its output to the bot for the next stage."

Taskmaster reads Stages 2-9 below and builds the rest of the team itself.

## Step 4 — Download the mobile app

Get Grok Bot on your phone too, for Telegram-style check-ins once the team's
running, no need to be at your desk to see what's happening.

`cold-email-kickoff/` in this folder is Taskmaster's own core skill, load it
alongside the description above, it orchestrates ICP + lead magnet +
strategy + plan in one flow.
