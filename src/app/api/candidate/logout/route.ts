import { route, json, assertSameOrigin } from "@/server/http";
import { logoutCandidateEmail } from "@/server/candidate-email-auth";

export const POST = route("candidate.email.logout", async (req: Request) => {
  assertSameOrigin(req);
  await logoutCandidateEmail();
  return json({ ok: true });
});
