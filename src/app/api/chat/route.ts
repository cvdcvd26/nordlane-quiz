import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { getVisitorChat, postVisitorMessage, messageQuerySchema } from "@/server/services/chat";
import { rateLimit } from "@/server/rate-limit";

/** Sequence cursors avoid missed messages with identical timestamps. */
export const GET = route("chat.get", async (req: Request) => {
  const sessionId = await requireVisitorSessionId();
  const query = messageQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json(await getVisitorChat(sessionId, query));
});

export const POST = route("chat.post", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`chat:${sessionId}`, 30, 60);
  const { message } = await postVisitorMessage(sessionId, await readJson(req));
  return json({ message }, 201);
});
