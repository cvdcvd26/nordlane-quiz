ALTER TABLE "testimonials" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "testimonials" ADD COLUMN "age" integer;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_age_ck" CHECK ("testimonials"."age" is null or "testimonials"."age" between 1 and 120);