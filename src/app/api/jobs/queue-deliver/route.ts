import { handleCallback } from "@vercel/queue";
import { z } from "zod";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { log } from "@/server/log";

export const maxDuration = 60;

const payloadSchema = z.object({ scheduledMessageId: z.string().uuid() }).strict();

/** The platform trigger makes this consumer private on Vercel. Other hosts use QStash. */
const callback = process.env.VERCEL ? handleCallback(async (payload: unknown, metadata) => {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    // A malformed internal payload cannot identify a job. Acknowledge it without logging its body.
    log.warn("scheduler.queue", "discarded invalid queue payload", { messageId: metadata.messageId });
    return;
  }

  const outcome = await deliverScheduledMessage(parsed.data.scheduledMessageId);
  if (outcome === "busy" || outcome === "not_due") throw new Error(`scheduled_delivery_${outcome}`);
  log.info("scheduler.queue", "scheduled delivery completed", {
    scheduledId: parsed.data.scheduledMessageId,
    messageId: metadata.messageId,
    deliveryCount: metadata.deliveryCount,
    outcome,
  });
}, {
  // Keep transient failures retryable until the message expires. The database job
  // remains available to the authenticated sweep/chat fallback throughout.
  retry: (_error, metadata) => ({ afterSeconds: Math.min(30, 2 ** Math.min(metadata.deliveryCount, 5)) }),
}) : null;

export async function POST(request: Request) {
  // vercel.json's private-trigger protection does not exist on a VPS/ordinary Next server.
  if (!callback) return new Response(null, { status: 404 });
  return callback(request);
}
