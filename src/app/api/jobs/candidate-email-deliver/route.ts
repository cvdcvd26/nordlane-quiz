import { z } from "zod";
import { json } from "@/server/http";
import { readBody } from "@/server/body";
import { verifyQueueSignature } from "@/server/queue";
import { deliverCandidateEmail } from "@/server/services/candidate-email-notifications";

const payloadSchema = z.object({ emailJobId: z.string().uuid() }).strict();
export async function POST(request: Request) {
  const raw = (await readBody(request, 1024)).toString("utf8");
  if (!await verifyQueueSignature(request, raw)) return json({ error: "unauthorized" }, 401);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: "bad_payload" }, 400); }
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return json({ error: "bad_payload" }, 400);
  try {
    const outcome = await deliverCandidateEmail(parsed.data.emailJobId);
    return json({ outcome }, outcome === "busy" ? 503 : 200);
  } catch { return json({ error: "email_delivery_failed" }, 503); }
}
