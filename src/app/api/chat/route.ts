import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { rateLimit } from "@/server/rate-limit";

/** Polling endpoint: ?after=<ISO time> returns only newer messages. */
export const GET = route("chat.get", async (req: Request) => {
  const sessionId = await requireVisitorSessionId();
  const afterParam = new URL(req.url).searchParams.get("after");
  const after = afterParam && !Number.isNaN(Date.parse(afterParam)) ? new Date(afterParam) : undefined;
  return json(await getVisitorChat(sessionId, after));
});

export const POST = route("chat.post", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`chat:${sessionId}`, 30, 60);
  const { message } = await postVisitorMessage(sessionId, await readJson(req));
  return json({ message }, 201);
});
