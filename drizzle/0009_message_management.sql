ALTER TABLE "conversations" ADD COLUMN "message_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "change_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "messages_conversation_changes_idx" ON "messages" USING btree ("conversation_id","change_revision");