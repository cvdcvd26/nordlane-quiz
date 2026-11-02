-- Drizzle applies all pending migrations in one transaction. Recreate the enum so
-- new values may be used by the reconciliation in that same transaction.
ALTER TABLE "leads" DROP CONSTRAINT "leads_candidate_result_ck";--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "status" TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "public"."lead_status";--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM ('new', 'in_progress', 'awaiting_reply', 'suitable', 'data_received', 'signal_working', 'completed', 'rejected', 'candidate_declined', 'no_contact');--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "status" TYPE "public"."lead_status" USING "status"::"public"."lead_status";--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'new'::"public"."lead_status";--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_candidate_result_ck" CHECK ((candidate_result_body is null and candidate_result_published_at is null) or
  (status = 'rejected' and candidate_result_body is not null and candidate_result_published_at is not null and length(btrim(candidate_result_body)) > 0));--> statement-breakpoint
CREATE TABLE "lead_status_migration_archive" (
	"lead_id" bigint PRIMARY KEY NOT NULL,
	"previous_status" text NOT NULL,
	"next_status" text NOT NULL,
	"previous_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_results" DROP CONSTRAINT "lead_results_closure_ck";--> statement-breakpoint
ALTER TABLE "lead_results" DROP CONSTRAINT "lead_results_closed_at_ck";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_status_migration_archive" ADD CONSTRAINT "lead_status_migration_archive_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_closure_ck" CHECK ("lead_results"."closure" in ('open', 'data_received', 'signal_working', 'not_suitable', 'candidate_declined', 'no_contact', 'completed'));--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_closed_at_ck" CHECK ("lead_results"."closure" not in ('open', 'data_received') or "lead_results"."closed_at" is null);
--> statement-breakpoint
-- Keep every original row before reconciling. Existing private snapshots and
-- history are never rewritten. leads.updated_at is not a status timestamp.
INSERT INTO lead_status_migration_archive (lead_id, previous_status, next_status, previous_result)
SELECT l.id, l.status::text,
  CASE
    WHEN l.candidate_result_published_at IS NOT NULL THEN 'rejected'
    WHEN l.status IN ('signal_working', 'rejected') THEN l.status::text
    WHEN r.closure = 'signal_working' THEN 'signal_working'
    WHEN r.closure = 'not_suitable' THEN 'rejected'
    WHEN r.closure IN ('candidate_declined', 'no_contact') THEN r.closure
    WHEN l.status IN ('data_received', 'completed') THEN l.status::text
    WHEN r.closure = 'data_received' THEN 'data_received'
    WHEN r.qualification = 'suitable' THEN 'suitable'
    ELSE l.status::text
  END,
  CASE WHEN r.lead_id IS NULL THEN NULL ELSE to_jsonb(r) END
FROM leads l LEFT JOIN lead_results r ON r.lead_id = l.id;
--> statement-breakpoint
UPDATE leads l SET status = a.next_status::"public"."lead_status"
FROM lead_status_migration_archive a WHERE a.lead_id = l.id AND l.status::text <> a.next_status;
