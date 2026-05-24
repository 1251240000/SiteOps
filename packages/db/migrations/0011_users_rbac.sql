-- 0011_users_rbac: add RBAC columns to users + create user_invitations table (T40).

-- Users: role / status / invited_by / invited_at / last_login_at
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'admin'
    CONSTRAINT "users_role_check" CHECK ("role" IN ('admin','operator','viewer')),
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active'
    CONSTRAINT "users_status_check" CHECK ("status" IN ('active','suspended')),
  ADD COLUMN IF NOT EXISTS "invited_by" uuid,
  ADD COLUMN IF NOT EXISTS "invited_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint

-- User invitations
CREATE TABLE IF NOT EXISTS "user_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'viewer',
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "invited_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
