-- OPTIONAL cross-run dedup registry for list-builder.
--
-- Without it the skill still works: scripts/registry.ts falls back to the per-run
-- write-ahead log (judged.wal.ndjson), so a single run never re-judges a domain.
-- With it, every lane you have ever run for a client is deduped against.
--
-- 1. Create the table in any Postgres database (Supabase works, so does plain Postgres).
-- 2. Export the connection string:  LIST_REGISTRY_DB_URL=<your postgres connection string>
-- 3. `psql` must be on PATH — registry.ts shells out to it.

CREATE TABLE IF NOT EXISTS list_builder_judged_domains (
  domain          text        NOT NULL,   -- normalized apex, the dedup key
  domain_raw      text,
  client_slug     text        NOT NULL,
  lane            text        NOT NULL,
  verdict         text        NOT NULL,   -- nano_qualified | nano_rejected | verified | verify_rejected | enrich_failed
  confidence      numeric,
  prompt_sha      text,
  source          text,                   -- pull | lookalike | sweep | seed | maps | getleads
  name            text,
  employee_count  numeric,
  state           text,
  judged_at       timestamptz,
  run_id          text,
  PRIMARY KEY (domain, client_slug, lane)
);

CREATE INDEX IF NOT EXISTS list_builder_judged_domains_client_idx
  ON list_builder_judged_domains (client_slug, lane);

-- On Supabase, enable RLS: every script here connects as the owner/service role,
-- which bypasses RLS, so no policies are needed for backend-only access.
ALTER TABLE list_builder_judged_domains ENABLE ROW LEVEL SECURITY;
