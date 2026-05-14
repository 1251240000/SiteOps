CREATE TABLE "site_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"month" date NOT NULL,
	"hosting_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"domain_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"content_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"ads_spend_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"other_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_costs_month_first_day_chk" CHECK (EXTRACT(DAY FROM "site_costs"."month") = 1),
	CONSTRAINT "site_costs_amounts_chk" CHECK (
		"site_costs"."hosting_usd" >= 0
		AND "site_costs"."domain_usd" >= 0
		AND "site_costs"."content_usd" >= 0
		AND "site_costs"."ads_spend_usd" >= 0
		AND "site_costs"."other_usd" >= 0
	)
);
--> statement-breakpoint
ALTER TABLE "site_costs" ADD CONSTRAINT "site_costs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_costs_site_month_uk" ON "site_costs" USING btree ("site_id","month");--> statement-breakpoint
CREATE INDEX "site_costs_month_idx" ON "site_costs" USING btree ("month");--> statement-breakpoint
CREATE TRIGGER site_costs_set_updated_at BEFORE UPDATE ON "site_costs"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
