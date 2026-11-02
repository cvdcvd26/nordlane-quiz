import { route, json, assertSameOrigin, readJson, clientIp } from "@/server/http";
import { getOrCreateVisitorSessionId } from "@/server/visitor-session";
import { requestCandidateEmail } from "@/server/candidate-email-auth";

export const POST = route("candidate.email.request", async (req: Request) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const sessionId = await getOrCreateVisitorSessionId(ip);
  return json(await requestCandidateEmail(sessionId, await readJson(req, 2048), ip));
});
