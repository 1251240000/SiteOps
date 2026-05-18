-- T26: add hot-path indexes for the agent-runs dashboard.
-- The base table was created in 0000_init.sql with (api_key_id) and (action)
-- indexes; these two cover the dashboard's default sort + the failure-rate
-- filter without table scans.
CREATE INDEX "agent_runs_created_idx" ON "agent_runs" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "agent_runs_status_created_idx" ON "agent_runs" USING btree ("status","created_at" DESC);
