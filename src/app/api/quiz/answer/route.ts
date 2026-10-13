import { z } from "zod";
import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { saveAnswer } from "@/server/services/quiz";
import { rateLimit } from "@/server/rate-limit";

const bodySchema = z.object({ questionKey: z.string().max(50), answer: z.string().max(50) });

export const PUT = route("quiz.answer", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`answer:${sessionId}`, 60, 60);
  const { questionKey, answer } = bodySchema.parse(await readJson(req));
  await saveAnswer(sessionId, questionKey, answer);
  return json({ ok: true });
});
