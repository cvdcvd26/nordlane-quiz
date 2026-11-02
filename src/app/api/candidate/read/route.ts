import { z } from "zod";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { rateLimit } from "@/server/rate-limit";
import { markCandidateMessagesRead } from "@/server/services/candidate-email-notifications";

const input = z.object({ sequence: z.string().regex(/^[1-9]\d{0,18}$/) }).strict();

export const POST = route("candidate.read", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`candidate-read:${sessionId}`, 120, 60);
  const { sequence } = input.parse(await readJson(req, 1024));
  await markCandidateMessagesRead(sessionId, sequence);
  return json({ ok: true });
});
