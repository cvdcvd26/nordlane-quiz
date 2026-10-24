import { cookies } from "next/headers";
import { COOKIE_CONSENT_NAME, parseCookieConsent } from "@/lib/cookie-consent";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { syncVisitorAttribution } from "@/server/services/visitor-activity";
import { requireVisitorSessionId } from "@/server/visitor-session";

export const POST = route("visitor.attribution", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`visitor-attribution:${sessionId}`, 30, 60);
  const consent = parseCookieConsent((await cookies()).get(COOKIE_CONSENT_NAME)?.value);
  await syncVisitorAttribution(sessionId, await readJson(req), consent);
  return json({ ok: true });
});
