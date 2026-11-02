CREATE TABLE "candidate_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_accounts_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "candidate_accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "candidate_accounts_email_ck" CHECK ("candidate_accounts"."email" = lower(btrim("candidate_accounts"."email")) and length("candidate_accounts"."email") between 3 and 254)
);
--> statement-breakpoint
CREATE TABLE "candidate_device_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_device_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "candidate_email_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"email" text NOT NULL,
	"browser_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_email_challenges_status_ck" CHECK ("candidate_email_challenges"."status" in ('sending', 'ready', 'failed', 'consumed')),
	CONSTRAINT "candidate_email_challenges_attempts_ck" CHECK ("candidate_email_challenges"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "candidate_accounts" ADD CONSTRAINT "candidate_accounts_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_device_sessions" ADD CONSTRAINT "candidate_device_sessions_account_id_candidate_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."candidate_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_email_challenges" ADD CONSTRAINT "candidate_email_challenges_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_device_sessions_account_idx" ON "candidate_device_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "candidate_device_sessions_expiry_idx" ON "candidate_device_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "candidate_email_challenges_expiry_idx" ON "candidate_email_challenges" USING btree ("expires_at");
