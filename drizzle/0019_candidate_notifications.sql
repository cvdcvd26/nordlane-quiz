CREATE TABLE "candidate_email_budget_lock" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_email_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"through_sequence" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_email_jobs_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "candidate_email_jobs_kind_ck" CHECK ("candidate_email_jobs"."kind" in ('welcome', 'chat')),
	CONSTRAINT "candidate_email_jobs_status_ck" CHECK ("candidate_email_jobs"."status" in ('pending', 'sending', 'sent', 'cancelled', 'failed', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "candidate_email_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_email_state" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"last_read_sequence" bigint DEFAULT 0 NOT NULL,
	"last_notified_sequence" bigint DEFAULT 0 NOT NULL,
	"last_notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "candidate_email_jobs" ADD CONSTRAINT "candidate_email_jobs_account_id_candidate_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."candidate_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_email_state" ADD CONSTRAINT "candidate_email_state_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_email_pending_chat_uq" ON "candidate_email_jobs" USING btree ("account_id") WHERE "candidate_email_jobs"."kind" = 'chat' and "candidate_email_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "candidate_email_jobs_due_idx" ON "candidate_email_jobs" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "candidate_email_sends_created_idx" ON "candidate_email_sends" USING btree ("created_at");
--> statement-breakpoint
INSERT INTO "candidate_email_budget_lock" ("key") VALUES ('global');
