CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"site_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"dedupe_key" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"claim_lease_until" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('queued','claimed','succeeded','failed','cancelled','expired')),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" BETWEEN -100 AND 100),
	CONSTRAINT "tasks_max_attempts_check" CHECK ("tasks"."max_attempts" BETWEEN 1 AND 10),
	CONSTRAINT "tasks_attempts_nonneg_check" CHECK ("tasks"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_claim_idx" ON "tasks" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX "tasks_kind_idx" ON "tasks" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "tasks_site_idx" ON "tasks" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_lease_idx" ON "tasks" USING btree ("claim_lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_dedupe_active_uk" ON "tasks" USING btree ("dedupe_key") WHERE "tasks"."dedupe_key" IS NOT NULL AND "tasks"."status" IN ('queued','claimed');--> statement-breakpoint
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON "tasks"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
