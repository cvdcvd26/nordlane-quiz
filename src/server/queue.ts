import { Client, Receiver } from "@upstash/qstash";

/** External delayed-job queue. Production: Upstash QStash (works with Vercel serverless). */
export interface JobQueue {
  /** Enqueue delivery of a scheduled message. Must be idempotent for the same id. */
  scheduleDelivery(scheduledMessageId: string, notBefore: Date): Promise<string | null>;
}

export function appUrl() {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return "http://localhost:3000";
}

export const DELIVERY_PATH = "/api/jobs/deliver";

const qstashQueue: JobQueue = {
  async scheduleDelivery(id, notBefore) {
    const token = process.env.QSTASH_TOKEN;
    if (!token) {
      if (!process.env.VERCEL) return null; // local dev: the backup sweep / chat poll delivers when due
      throw new Error("QSTASH_TOKEN is not set");
    }
    const client = new Client({ token, baseUrl: process.env.QSTASH_URL });
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

let current: JobQueue = qstashQueue;
export const queue = () => current;
/** Test hook. */
export const setQueue = (q: JobQueue | null) => {
  current = q ?? qstashQueue;
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
