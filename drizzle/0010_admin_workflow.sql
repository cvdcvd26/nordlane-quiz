CREATE TABLE "lead_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" bigint NOT NULL,
	"body" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_reminders_body_ck" CHECK (length(btrim("lead_reminders"."body")) between 1 and 500),
	CONSTRAINT "lead_reminders_revision_ck" CHECK ("lead_reminders"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" bigint NOT NULL,
	"instructions" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_message_id" uuid,
	"response_message_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "task_revisions_status_ck" CHECK ("task_revisions"."status" in ('pending', 'submitted', 'cancelled')),
	CONSTRAINT "task_revisions_instructions_ck" CHECK (length(btrim("task_revisions"."instructions")) between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "visitor_attribution" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"consent_all" boolean DEFAULT false NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"referrer_host" text,
	"task_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_reminders" ADD CONSTRAINT "lead_reminders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_reminders" ADD CONSTRAINT "lead_reminders_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_request_message_id_messages_id_fk" FOREIGN KEY ("request_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_response_message_id_messages_id_fk" FOREIGN KEY ("response_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_attribution" ADD CONSTRAINT "visitor_attribution_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_reminders_lead_idx" ON "lead_reminders" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_reminders_due_idx" ON "lead_reminders" USING btree ("due_at") WHERE "lead_reminders"."completed_at" is null;--> statement-breakpoint
CREATE INDEX "task_revisions_lead_idx" ON "task_revisions" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_revisions_pending_uq" ON "task_revisions" USING btree ("lead_id") WHERE "task_revisions"."status" = 'pending';