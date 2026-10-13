import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { submitTask } from "@/server/services/submission";
import { rateLimit } from "@/server/rate-limit";

export const POST = route("submit", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`submit:${sessionId}`, 10, 10 * 60);
  const result = await submitTask(sessionId, await readJson(req));
  return json(result, result.duplicate ? 200 : 201);
});
