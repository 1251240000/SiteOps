CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"delivery_id" text NOT NULL,
	"signature_ok" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"site_id" uuid,
	"processed_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_check" CHECK ("webhook_events"."provider" IN ('cloudflare','github')),
	CONSTRAINT "webhook_events_attempts_nonneg_check" CHECK ("webhook_events"."attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_delivery_uk" ON "webhook_events" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_events_provider_created_idx" ON "webhook_events" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("provider","created_at") WHERE "webhook_events"."processed_at" IS NULL;
