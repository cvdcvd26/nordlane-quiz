ALTER TABLE "messages" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS position FROM messages
)
UPDATE messages SET sequence = ordered.position FROM ordered WHERE messages.id = ordered.id;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('messages', 'sequence'),
  GREATEST(COALESCE((SELECT max(sequence) FROM messages), 0), 1),
  EXISTS (SELECT 1 FROM messages));--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sequence_uq" ON "messages" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "messages_conversation_sequence_idx" ON "messages" USING btree ("conversation_id","sequence");
