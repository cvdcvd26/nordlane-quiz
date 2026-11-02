import { handleCallback } from "@vercel/queue";
import { z } from "zod";
import { deliverCandidateEmail } from "@/server/services/candidate-email-notifications";

export const maxDuration = 60;
const payloadSchema = z.object({ emailJobId: z.string().uuid() }).strict();
const callback = process.env.VERCEL ? handleCallback(async (payload: unknown) => {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return;
  const outcome = await deliverCandidateEmail(parsed.data.emailJobId);
  if (outcome === "busy") throw new Error("candidate_email_busy");
}, {
  retry: (_error, metadata) => ({ afterSeconds: Math.min(120, 2 ** Math.min(metadata.deliveryCount, 7)) }),
}) : null;

export async function POST(request: Request) {
  if (!callback) return new Response(null, { status: 404 });
  return callback(request);
}
