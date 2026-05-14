CREATE TABLE "affiliate_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"program" text NOT NULL,
	"amount_usd" numeric(10, 4) NOT NULL,
	"amount_raw" numeric(10, 4),
	"currency" text,
	"payout_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_entries_period_chk" CHECK ("affiliate_entries"."period_end" >= "affiliate_entries"."period_start"),
	CONSTRAINT "affiliate_entries_amount_chk" CHECK ("affiliate_entries"."amount_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "affiliate_entries" ADD CONSTRAINT "affiliate_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_entries_site_period_idx" ON "affiliate_entries" USING btree ("site_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "affiliate_entries_period_idx" ON "affiliate_entries" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE TRIGGER affiliate_entries_set_updated_at BEFORE UPDATE ON "affiliate_entries"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
