ALTER TABLE "lead_results" DROP CONSTRAINT "lead_results_closure_ck";--> statement-breakpoint
ALTER TABLE "lead_results" DROP CONSTRAINT "lead_results_closed_at_ck";--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_closure_ck" CHECK ("lead_results"."closure" in ('open', 'data_received', 'signal_working', 'not_suitable', 'candidate_declined', 'no_contact'));--> statement-breakpoint
ALTER TABLE "lead_results" ADD CONSTRAINT "lead_results_closed_at_ck" CHECK (("lead_results"."closure" in ('open', 'data_received')) = ("lead_results"."closed_at" is null));