-- T34: switch tasks_claim_idx / tasks_lease_idx to partial, ordered indexes.
--
-- Hot paths:
--   * claimNext: WHERE status='queued' AND available_at<=now()
--                ORDER BY priority DESC, available_at ASC LIMIT 1
--                → wants (priority DESC, available_at ASC) WHERE status='queued'
--                so the planner returns ordered rows without a Sort node.
--   * sweepExpiredLeases: WHERE status='claimed' AND claim_lease_until<=now()
--                → wants (claim_lease_until) WHERE status='claimed' so the
--                planner does a tight range scan over only the in-flight rows.
--
-- Partial indexes shrink the index footprint, skip maintenance on rows whose
-- status is terminal (succeeded/failed/cancelled/expired), and let the planner
-- use index-order scans for the hot ORDER BY without a Sort step.
--
-- DROP + CREATE (non-CONCURRENT) is fine for SiteOps: the tasks table is
-- still small in M0-M7. On a hot prod DB you'd add CREATE INDEX CONCURRENTLY
-- behind a feature flag; Drizzle's migrator can't run CONCURRENTLY today.
DROP INDEX IF EXISTS "tasks_claim_idx";--> statement-breakpoint
CREATE INDEX "tasks_claim_idx" ON "tasks" USING btree ("priority" DESC NULLS LAST, "available_at") WHERE "status" = 'queued';--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_lease_idx";--> statement-breakpoint
CREATE INDEX "tasks_lease_idx" ON "tasks" USING btree ("claim_lease_until") WHERE "status" = 'claimed';
