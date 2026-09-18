#!/usr/bin/env tsx
/**
 * Bulk enable/disable warmup on Smartlead inboxes.
 *
 * Usage:
 *   export SMARTLEAD_API_KEY=xxx
 *   npx tsx scripts/set-warmup.ts --mode=enable --tag=new --warmup-per-day=40 --ramp=5
 *   npx tsx scripts/set-warmup.ts --mode=disable --tag=active
 *   npx tsx scripts/set-warmup.ts --mode=insurance --tag=insurance
 *
 * Selector flags (pick one): --all, --ids=1,2,3, --domain=example.com, --tag=active, --ids-from-csv=path
 * Mode:
 *   --mode=enable       warmup on, full ramp (default: 40/day, ramp 5)
 *   --mode=disable      warmup off
 *   --mode=insurance    warmup on, low maintenance (15/day, no ramp)
 */

import { API_BASE, API_KEY, parseFlag, selectInboxes, runWithConcurrency } from "./_lib";

async function main() {
  const args = process.argv.slice(2);
  const mode = parseFlag(args, "--mode");
  if (!mode || !["enable", "disable", "insurance"].includes(mode)) {
    console.error("Usage: --mode=enable|disable|insurance [selector flags]");
    process.exit(1);
  }

  const warmupPerDay = Number(parseFlag(args, "--warmup-per-day") ?? (mode === "insurance" ? 15 : 40));
  const ramp = Number(parseFlag(args, "--ramp") ?? (mode === "insurance" ? 0 : 5));
  const replyRate = parseFlag(args, "--reply-rate") ?? "20";

  console.error(`Selecting inboxes...`);
  const inboxes = await selectInboxes(args);
  console.error(`Matched ${inboxes.length} inboxes. Mode: ${mode}`);

  if (inboxes.length === 0) {
    console.error("No inboxes matched; nothing to do.");
    return;
  }

  const body =
    mode === "disable"
      ? { warmup_enabled: "false" }
      : {
          warmup_enabled: "true",
          total_warmup_per_day: warmupPerDay,
          daily_rampup: ramp,
          reply_rate_percentage: replyRate,
        };

  console.error(`Payload: ${JSON.stringify(body)}`);
  console.error(`Proceeding in 3s... (Ctrl+C to abort)`);
  await new Promise((r) => setTimeout(r, 3000));

  let ok = 0;
  let fail = 0;
  await runWithConcurrency(inboxes, 5, async (inbox, i) => {
    const url = `${API_BASE}/email-accounts/${inbox.id}/warmup?api_key=${API_KEY}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`${resp.status}: ${t.slice(0, 120)}`);
      }
      ok++;
      if ((i + 1) % 20 === 0) console.error(`  ${i + 1}/${inboxes.length} processed`);
    } catch (err) {
      fail++;
      console.error(`  [${inbox.id}] ${inbox.from_email}: ${String(err).slice(0, 200)}`);
    }
  });

  console.error(`\nDone. ${ok} updated, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
