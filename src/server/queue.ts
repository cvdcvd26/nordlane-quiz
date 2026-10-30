import { Client, Receiver } from "@upstash/qstash";
import { send } from "@vercel/queue";

/** Durable delayed jobs. Vercel uses its managed queue; other hosts retain QStash. */
export interface JobQueue {
  /** Enqueue delivery of a scheduled message. Must be idempotent for the same id. */
  scheduleDelivery(scheduledMessageId: string, notBefore: Date): Promise<string | null>;
}

export function appUrl() {
  const explicit = process.env.APP_URL;
  if (explicit) {
    const url = new URL(explicit);
    if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash)
      throw new Error("APP_URL must be an HTTP(S) origin without a path, query or fragment");
    return url.origin;
  }
  // Preview callbacks must reach the deployment that created the job.
  const preview = process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_URL : undefined;
  if (preview) return `https://${preview}`;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL must be configured for QStash outside Vercel");
  return "http://localhost:3000";
}

export const DELIVERY_PATH = "/api/jobs/deliver";
export const AUTO_REPLY_TOPIC = "alleybiz-auto-replies";
export const AUTO_REPLY_RETENTION_SECONDS = 7 * 24 * 60 * 60;

const vercelQueue: JobQueue = {
  async scheduleDelivery(id, notBefore) {
    const delaySeconds = Math.max(0, Math.ceil((notBefore.getTime() - Date.now()) / 1000));
    if (!Number.isFinite(delaySeconds) || delaySeconds >= AUTO_REPLY_RETENTION_SECONDS) {
      throw new RangeError("Scheduled delivery is outside the queue retention period");
    }
    const result = await send(AUTO_REPLY_TOPIC, { scheduledMessageId: id }, {
      delaySeconds,
      retentionSeconds: AUTO_REPLY_RETENTION_SECONDS,
      idempotencyKey: `scheduled-${id}`,
    });
    return result.messageId ? `vercel:${result.messageId}` : null;
  },
};

const qstashQueue: JobQueue = {
  async scheduleDelivery(id, notBefore) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      if (!process.env.VERCEL) return null; // local dev: the backup sweep / chat poll delivers when due
      throw new Error("QSTASH_TOKEN is not set");
    }
    const client = new Client({ token, baseUrl: process.env.QSTASH_URL || undefined });
    const res = await client.publishJSON({
      url: `${appUrl()}${DELIVERY_PATH}`,
      body: { scheduledMessageId: id },
      notBefore: Math.ceil(notBefore.getTime() / 1000),
      // Same id → QStash accepts but never enqueues a duplicate.
      deduplicationId: `scheduled-${id}`,
      retries: 5,
    });
    return "messageId" in res ? (res.messageId as string) : null;
  },
};

let current: JobQueue | null = null;
export const queue = () => current ?? (process.env.VERCEL ? vercelQueue : qstashQueue);
/** Test hook. */
export const setQueue = (q: JobQueue | null) => {
  current = q;
};

/** Verifies that a job request really comes from QStash. */
export async function verifyQueueSignature(req: Request, rawBody: string) {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY ?? "",
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? "",
  });
  try {
    return await receiver.verify({
      signature,
      body: rawBody,
      upstashRegion: req.headers.get("upstash-region") ?? undefined,
      clockTolerance: 5,
    });
  } catch {
    return false;
  }
}
