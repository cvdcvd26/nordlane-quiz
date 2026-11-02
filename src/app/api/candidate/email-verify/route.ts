import { after } from "next/server";
import { route, json, assertSameOrigin, readJson, clientIp } from "@/server/http";
import { verifyCandidateEmail } from "@/server/candidate-email-auth";
import { enqueueCandidateEmail } from "@/server/services/candidate-email-notifications";

export const POST = route("candidate.email.verify", async (req: Request) => {
  assertSameOrigin(req);
  const { welcomeJobId } = await verifyCandidateEmail(await readJson(req, 2048), clientIp(req));
  if (welcomeJobId) after(async () => {
    // The outbox has committed. Queue latency/failure must not delay login cookies.
    await enqueueCandidateEmail(welcomeJobId).catch(() => {
      console.warn("candidate.email.welcome_enqueue_failed");
    });
  });
  return json({ verified: true });
});
