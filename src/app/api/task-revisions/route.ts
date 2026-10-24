import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { getVisitorRevision, submitTaskRevision } from "@/server/services/task-revisions";
import { rateLimit } from "@/server/rate-limit";

export const GET = route("revisions.get", async () => {
  const sessionId = await requireVisitorSessionId();
  return json(await getVisitorRevision(sessionId));
});

export const POST = route("revisions.post", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`revision-response:${sessionId}`, 20, 60);
  return json({ revision: await submitTaskRevision(sessionId, await readJson(req)) }, 201);
});
