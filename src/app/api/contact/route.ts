import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { saveContact } from "@/server/services/contact";
import { rateLimit } from "@/server/rate-limit";

export const PUT = route("contact", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`contact:${sessionId}`, 30, 60);
  const contact = await saveContact(sessionId, await readJson(req));
  return json({ contact });
});
