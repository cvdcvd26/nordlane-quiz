CREATE TABLE "visitor_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"telegram" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitor_contacts_name_nonempty" CHECK (length(btrim("visitor_contacts"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "visitor_contacts" ADD CONSTRAINT "visitor_contacts_session_id_visitor_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."visitor_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_contacts_session_uq" ON "visitor_contacts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "visitor_contacts_phone_idx" ON "visitor_contacts" USING btree ("phone");