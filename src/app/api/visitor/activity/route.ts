import { cookies } from "next/headers";
import { COOKIE_CONSENT_NAME, parseCookieConsent } from "@/lib/cookie-consent";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { recordVisitorActivity } from "@/server/services/visitor-activity";
import { requireVisitorSessionId } from "@/server/visitor-session";

export const POST = route("visitor.activity", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`visitor-activity:${sessionId}`, 30, 60);
  const consent = parseCookieConsent((await cookies()).get(COOKIE_CONSENT_NAME)?.value);
  return json(await recordVisitorActivity(sessionId, await readJson(req), consent));
});
