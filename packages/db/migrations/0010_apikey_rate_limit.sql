-- T38: per-API-key rate limit override.
--
-- Adds an optional `rate_limit_per_min` column to `api_keys`. NULL means
-- "use the global default" (env `API_KEY_RATE_LIMIT_PER_MIN`, currently
-- 600/min). Non-null integers override the default for that specific key
-- without disturbing siblings — useful when one Agent legitimately needs a
-- higher budget or when a noisy client must be throttled below the floor.
--
-- Storage is plain INT (not smallint) to leave room for future bursts;
-- non-negative is enforced via CHECK so an admin can't slam in `0` and
-- accidentally lock out the key (use `revoked_at` for that).
ALTER TABLE "api_keys"
  ADD COLUMN "rate_limit_per_min" integer;--> statement-breakpoint
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_rate_limit_per_min_check"
  CHECK ("rate_limit_per_min" IS NULL OR "rate_limit_per_min" > 0);
