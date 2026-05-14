CREATE TABLE "integration_credentials" (
	"provider" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"encrypted_payload" text NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credentials_uk" ON "integration_credentials" USING btree ("provider","scope");
