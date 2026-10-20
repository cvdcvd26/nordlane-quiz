ALTER TABLE "leads" ADD COLUMN "candidate_result_body" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "candidate_result_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_candidate_result_ck" CHECK (("leads"."candidate_result_body" is null and "leads"."candidate_result_published_at" is null) or
      ("leads"."status" = 'rejected' and "leads"."candidate_result_body" is not null and "leads"."candidate_result_published_at" is not null and length(btrim("leads"."candidate_result_body")) > 0));