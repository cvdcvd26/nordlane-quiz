CREATE TYPE "public"."testimonial_status" AS ENUM('pending', 'published', 'rejected');--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text NOT NULL,
	"status" "testimonial_status" DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "testimonials_rating_ck" CHECK ("testimonials"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "testimonial_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "testimonials_session_uq" ON "testimonials" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "testimonials_status_idx" ON "testimonials" USING btree ("status","published_at");