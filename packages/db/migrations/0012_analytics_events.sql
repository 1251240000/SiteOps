-- 0012_analytics_events: self-hosted frontend analytics collector (T64).
ALTER TABLE "sites"
  ADD COLUMN IF NOT EXISTS "public_analytics_key" text NOT NULL DEFAULT ('site_pk_' || encode(gen_random_bytes(18), 'hex'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sites_public_analytics_key_uk" ON "sites" USING btree ("public_analytics_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
  "visitor_id" text NOT NULL,
  "session_id" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "referrer" text,
  "utm" jsonb,
  "device" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_sessions_site_session_uk" ON "analytics_sessions" USING btree ("site_id","session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_site_seen_idx" ON "analytics_sessions" USING btree ("site_id","last_seen_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_sessions_site_visitor_idx" ON "analytics_sessions" USING btree ("site_id","visitor_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL REFERENCES "sites"("id") ON DELETE cascade,
  "session_id" text NOT NULL,
  "visitor_id" text NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "path" text,
  "url" text,
  "referrer" text,
  "properties" jsonb,
  "event_hash" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analytics_events_type_chk" CHECK ("type" IN ('pageview','event','web_vital','identify'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_site_hash_uk" ON "analytics_events" USING btree ("site_id","event_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_site_time_idx" ON "analytics_events" USING btree ("site_id","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_site_type_name_idx" ON "analytics_events" USING btree ("site_id","type","name","occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_site_path_idx" ON "analytics_events" USING btree ("site_id","path","occurred_at");
