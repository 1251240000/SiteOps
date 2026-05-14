-- 0000_init: bootstrap extensions, tables, indexes, and updated_at triggers.
-- gen_random_uuid() ships natively in PG 13+; pgcrypto kept for portability.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"primary_url" text NOT NULL,
	"site_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"target_country" text,
	"target_language" text,
	"tech_stack" jsonb,
	"repo_url" text,
	"repo_provider" text,
	"cf_account_id" text,
	"cf_pages_project" text,
	"analytics_provider" text,
	"analytics_id" text,
	"search_console_property" text,
	"adsense_publisher_id" text,
	"adsense_status" text,
	"health_score" smallint DEFAULT 100 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_site_type_check" CHECK ("sites"."site_type" IN ('directory','tool','content','forum','landing')),
	CONSTRAINT "sites_status_check" CHECK ("sites"."status" IN ('active','paused','archived')),
	CONSTRAINT "sites_repo_provider_check" CHECK ("sites"."repo_provider" IS NULL OR "sites"."repo_provider" IN ('github','gitlab','gitee')),
	CONSTRAINT "sites_analytics_provider_check" CHECK ("sites"."analytics_provider" IS NULL OR "sites"."analytics_provider" IN ('ga4','plausible','none')),
	CONSTRAINT "sites_adsense_status_check" CHECK ("sites"."adsense_status" IS NULL OR "sites"."adsense_status" IN ('pending','approved','rejected','not_applied')),
	CONSTRAINT "sites_health_score_range" CHECK ("sites"."health_score" >= 0 AND "sites"."health_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"registrar" text,
	"registered_at" date,
	"expires_at" date,
	"auto_renew" boolean,
	"dns_provider" text,
	"ssl_issuer" text,
	"ssl_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"provider" text,
	"provider_deployment_id" text,
	"commit_sha" text,
	"commit_message" text,
	"branch" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"build_log_url" text,
	"triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_provider_check" CHECK ("deployments"."provider" IS NULL OR "deployments"."provider" IN ('cloudflare_pages','github_pages','vercel','netlify','manual')),
	CONSTRAINT "deployments_status_check" CHECK ("deployments"."status" IN ('queued','building','success','failed','cancelled')),
	CONSTRAINT "deployments_triggered_by_check" CHECK ("deployments"."triggered_by" IS NULL OR "deployments"."triggered_by" IN ('human','git_push','agent','schedule'))
);
--> statement-breakpoint
CREATE TABLE "uptime_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"status_code" smallint,
	"response_time_ms" integer,
	"ok" boolean NOT NULL,
	"error" text,
	"region" text DEFAULT 'local' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_run_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"url" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_findings_severity_check" CHECK ("audit_findings"."severity" IN ('info','warning','error','critical'))
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"audit_type" text NOT NULL,
	"status" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"score" smallint,
	"summary" jsonb,
	"raw_report_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_runs_type_check" CHECK ("audit_runs"."audit_type" IN ('seo','lighthouse','links','compliance')),
	CONSTRAINT "audit_runs_status_check" CHECK ("audit_runs"."status" IS NULL OR "audit_runs"."status" IN ('running','success','failed')),
	CONSTRAINT "audit_runs_score_range" CHECK ("audit_runs"."score" IS NULL OR ("audit_runs"."score" >= 0 AND "audit_runs"."score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "adsense_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"earnings_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"rpm" numeric(10, 4),
	"ctr" numeric(5, 4)
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"pv" integer DEFAULT 0 NOT NULL,
	"uv" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"bounce_rate" numeric(5, 4),
	"avg_session_sec" integer,
	"revenue_usd" numeric(10, 4),
	"ad_revenue_usd" numeric(10, 4),
	"affiliate_revenue_usd" numeric(10, 4),
	"uptime_pct" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_console_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"site_id" uuid NOT NULL,
	"date" date NOT NULL,
	"query" text,
	"country" text,
	"device" text,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"ctr" numeric(5, 4),
	"position" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"source" text NOT NULL,
	"level" text NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text,
	"stack" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"meta" jsonb,
	CONSTRAINT "errors_source_check" CHECK ("errors"."source" IN ('js','build','api','worker')),
	CONSTRAINT "errors_level_check" CHECK ("errors"."level" IN ('error','warning'))
);
--> statement-breakpoint
CREATE TABLE "alert_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_channels_type_check" CHECK ("alert_channels"."type" IN ('webhook','email','feishu','dingtalk','slack','telegram'))
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"site_id" uuid,
	"metric" text NOT NULL,
	"operator" text NOT NULL,
	"threshold" numeric NOT NULL,
	"window_minutes" smallint,
	"consecutive" smallint DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"channel_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_scope_check" CHECK ("alert_rules"."scope" IN ('global','site')),
	CONSTRAINT "alert_rules_metric_check" CHECK ("alert_rules"."metric" IN ('uptime','ssl_expiry','domain_expiry','lighthouse_perf','error_rate','custom')),
	CONSTRAINT "alert_rules_operator_check" CHECK ("alert_rules"."operator" IN ('lt','lte','gt','gte','eq')),
	CONSTRAINT "alert_rules_scope_site_consistency" CHECK (("alert_rules"."scope" = 'global' AND "alert_rules"."site_id" IS NULL) OR ("alert_rules"."scope" = 'site' AND "alert_rules"."site_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"site_id" uuid,
	"status" text NOT NULL,
	"value" numeric,
	"message" text,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_channels" jsonb,
	CONSTRAINT "alerts_status_check" CHECK ("alerts"."status" IN ('firing','resolved'))
);
--> statement-breakpoint
CREATE TABLE "jobs_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"job_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"meta" jsonb,
	CONSTRAINT "jobs_log_status_check" CHECK ("jobs_log"."status" IN ('success','failed'))
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"agent_name" text NOT NULL,
	"action" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" IN ('success','failed'))
);
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adsense_daily" ADD CONSTRAINT "adsense_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_console_daily" ADD CONSTRAINT "search_console_daily_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "errors" ADD CONSTRAINT "errors_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uk" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uk" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_slug_uk" ON "sites" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sites_site_type_idx" ON "sites" USING btree ("site_type");--> statement-breakpoint
CREATE INDEX "sites_status_idx" ON "sites" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sites_target_country_idx" ON "sites" USING btree ("target_country");--> statement-breakpoint
CREATE INDEX "sites_tags_gin_idx" ON "sites" USING gin ("tags");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_domain_uk" ON "domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domains_site_id_idx" ON "domains" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "domains_expires_at_idx" ON "domains" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "domains_ssl_expires_at_idx" ON "domains" USING btree ("ssl_expires_at");--> statement-breakpoint
CREATE INDEX "deployments_site_started_idx" ON "deployments" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "uptime_checks_site_checked_idx" ON "uptime_checks" USING btree ("site_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_findings_site_severity_idx" ON "audit_findings" USING btree ("site_id","severity");--> statement-breakpoint
CREATE INDEX "audit_findings_code_idx" ON "audit_findings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "audit_findings_run_idx" ON "audit_findings" USING btree ("audit_run_id");--> statement-breakpoint
CREATE INDEX "audit_runs_site_started_idx" ON "audit_runs" USING btree ("site_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_runs_type_idx" ON "audit_runs" USING btree ("audit_type");--> statement-breakpoint
CREATE UNIQUE INDEX "adsense_daily_site_date_uk" ON "adsense_daily" USING btree ("site_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "metrics_daily_site_date_uk" ON "metrics_daily" USING btree ("site_id","date");--> statement-breakpoint
CREATE INDEX "metrics_daily_date_idx" ON "metrics_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "search_console_daily_uk" ON "search_console_daily" USING btree ("site_id","date","query","country","device");--> statement-breakpoint
CREATE INDEX "search_console_daily_site_date_idx" ON "search_console_daily" USING btree ("site_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "errors_site_fingerprint_uk" ON "errors" USING btree ("site_id","fingerprint");--> statement-breakpoint
CREATE INDEX "errors_site_last_seen_idx" ON "errors" USING btree ("site_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alert_rules_site_idx" ON "alert_rules" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_site_fired_idx" ON "alerts" USING btree ("site_id","fired_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "alerts_rule_idx" ON "alerts" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "jobs_log_queue_finished_idx" ON "jobs_log" USING btree ("queue","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_log_status_idx" ON "jobs_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_runs_api_key_idx" ON "agent_runs" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "agent_runs_action_idx" ON "agent_runs" USING btree ("action");--> statement-breakpoint
-- Generic BEFORE UPDATE trigger to maintain updated_at on mutable tables.
-- Keep this self-contained (no moddatetime extension) to minimize install deps.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
	NEW.updated_at := now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON "sites"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();