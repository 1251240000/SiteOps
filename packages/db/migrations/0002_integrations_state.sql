CREATE TABLE "integrations_state" (
	"site_id" uuid,
	"provider" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_cursor" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations_state" ADD CONSTRAINT "integrations_state_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_state_site_provider_uk" ON "integrations_state" USING btree ("site_id","provider") WHERE "integrations_state"."site_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_state_global_provider_uk" ON "integrations_state" USING btree ("provider") WHERE "integrations_state"."site_id" IS NULL;--> statement-breakpoint
CREATE INDEX "integrations_state_provider_idx" ON "integrations_state" USING btree ("provider");
