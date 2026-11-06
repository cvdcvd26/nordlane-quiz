CREATE TABLE "visitor_device_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "visitor_sessions"("id") ON DELETE cascade,
  "token_hash" text NOT NULL UNIQUE,
  "parent_token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "visitor_device_sessions_expiry_idx" ON "visitor_device_sessions" ("expires_at");
--> statement-breakpoint
CREATE TABLE "domain_session_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "browser_hash" text NOT NULL,
  "destination" text NOT NULL,
  "source_session_id" uuid REFERENCES "visitor_sessions"("id") ON DELETE cascade,
  "source_kind" text CHECK ("source_kind" in ('guest', 'candidate')),
  "source_token_hash" text,
  "grant_hash" text UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "domain_session_transfers_expiry_idx" ON "domain_session_transfers" ("expires_at");
