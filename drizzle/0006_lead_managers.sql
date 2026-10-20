CREATE TABLE "managers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "managers" ("id", "name", "avatar") VALUES
  ('aneta', 'Aneta (HR)', '/aneta-hr.png'),
  ('maja', 'Maja (HR)', '/maja-hr.png'),
  ('hanna', 'Hanna (HR)', '/hanna-hr.png'),
  ('agnieszka', 'Agnieszka (HR)', '/agnieszka-hr.png');
--> statement-breakpoint
CREATE FUNCTION "pick_lead_manager"() RETURNS text
LANGUAGE sql VOLATILE
AS $$ SELECT id FROM public.managers ORDER BY random() LIMIT 1 $$;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "manager_id" text;
--> statement-breakpoint
-- Existing conversations already displayed Aneta; preserve that identity.
UPDATE "leads" SET "manager_id" = 'aneta';
--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "manager_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "manager_id" SET DEFAULT pick_lead_manager();
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_manager_id_managers_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."managers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_manager_idx" ON "leads" USING btree ("manager_id");
