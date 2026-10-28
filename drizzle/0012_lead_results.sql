CREATE TABLE "lead_result_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" bigint NOT NULL,
	"previous" jsonb NOT NULL,
	"next" jsonb NOT NULL,
	"actor_id" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_results" (
	"lead_id" bigint PRIMARY KEY NOT NULL,
	"qualification" text DEFAULT 'unreviewed' NOT NULL,
	"closure" text DEFAULT 'open' NOT NULL,
	"reason" text,
	"comment" text DEFAULT '' NOT NULL,
	"responsible_admin_id" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "lead_results_qualification_ck" CHECK ("lead_results"."qualification" in ('unreviewed', 'suitable', 'unsuitable')),
	CONSTRAINT "lead_results_closure_ck" CHECK ("lead_results"."closure" in ('open', 'signal_working', 'not_suitable', 'candidate_declined', 'no_contact')),
	CONSTRAINT "lead_results_consistency_ck" CHECK (("lead_results"."closure" = 'not_suitable') = ("lead_results"."qualification" = 'unsuitable') and ("lead_results"."closure" <> 'signal_working' or "lead_results"."qualification" = 'suitable')),
	CONSTRAINT "lead_results_reason_ck" CHECK ("lead_results"."reason" is null or "lead_results"."reason" in ('task', 'skills', 'conditions', 'schedule', 'communication', 'candidate_choice', 'other')),
	CONSTRAINT "lead_results_comment_ck" CHECK (length("lead_results"."comment") <= 2000),
	CONSTRAINT "lead_results_version_ck" CHECK ("lead_results"."version" >= 1),
	CONSTRAINT "lead_results_closed_at_ck" CHECK (("lead_results"."closure" = 'open') = ("lead_results"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "lead_result_history" ADD CONSTRAINT "lead_result_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_result_history" ADD CONSTRAINT "lead_result_history_actor_id_admin_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_responsible_admin_id_admin_users_id_fk" FOREIGN KEY ("responsible_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_updated_by_admin_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_result_history_version_uq" ON "lead_result_history" USING btree ("lead_id","version");--> statement-breakpoint
CREATE INDEX "lead_result_history_lead_idx" ON "lead_result_history" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_results_responsible_idx" ON "lead_results" USING btree ("responsible_admin_id");--> statement-breakpoint
CREATE INDEX "lead_results_closure_idx" ON "lead_results" USING btree ("closure");