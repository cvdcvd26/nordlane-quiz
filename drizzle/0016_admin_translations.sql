CREATE TABLE "translation_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "month" text NOT NULL,
  "reserved_micros" integer NOT NULL,
  "actual_micros" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "translation_usage_cost_check" CHECK ("reserved_micros" >= 0 and ("actual_micros" is null or "actual_micros" >= 0))
);
--> statement-breakpoint
CREATE INDEX "translation_usage_month_idx" ON "translation_usage" ("month");
--> statement-breakpoint
CREATE TABLE "message_translations" (
  "key" text PRIMARY KEY NOT NULL,
  "lead_id" bigint NOT NULL CONSTRAINT "message_translations_lead_id_leads_id_fk" REFERENCES "leads" ("id") ON DELETE CASCADE,
  "message_id" uuid CONSTRAINT "message_translations_message_id_messages_id_fk" REFERENCES "messages" ("id") ON DELETE CASCADE,
  "source_hash" text NOT NULL,
  "target" text NOT NULL,
  "policy" text NOT NULL,
  "status" text NOT NULL,
  "body" text,
  "body_rich" jsonb,
  "usage_id" uuid CONSTRAINT "message_translations_usage_id_translation_usage_id_fk" REFERENCES "translation_usage" ("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "message_translations_status_check" CHECK ("status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "message_translations_lead_idx" ON "message_translations" ("lead_id");
