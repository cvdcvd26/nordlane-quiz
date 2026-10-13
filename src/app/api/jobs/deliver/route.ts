import { z } from "zod";
import { json } from "@/server/http";
import { verifyQueueSignature } from "@/server/queue";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { log } from "@/server/log";

const bodySchema = z.object({ scheduledMessageId: z.string().uuid() });

/**
 * Called by Upstash QStash when a scheduled message is due.
 * 2xx = done (also for duplicates); 5xx = QStash retries with backoff.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyQueueSignature(req, raw))) {
    log.warn("scheduler", "rejected job with invalid signature");
    return json({ error: "invalid signature" }, 401);
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {}
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return json({ error: "bad payload" }, 400); // not retried usefully; acknowledge

  try {
    const outcome = await deliverScheduledMessage(parsed.data.scheduledMessageId);
    if (outcome === "busy") return json({ outcome }, 503); // another worker holds the lock → retry later
    return json({ outcome });
  } catch {
    return json({ error: "delivery failed" }, 500);
  }
}
