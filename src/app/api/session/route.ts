import { route, json, clientIp } from "@/server/http";
import { getOrCreateVisitorSessionId } from "@/server/visitor-session";
import { getVisitorState } from "@/server/services/quiz";
import { uploadConfig } from "@/config/settings";
import { marketingScope } from "@/server/marketing-scope";
import { getCandidateEmailState } from "@/server/candidate-email-auth";
import { cookies } from "next/headers";
import { findGuestCredential } from "@/server/visitor-credentials";

/** Creates (or restores) the visitor session and returns everything needed to resume the flow. */
export const GET = route("session", async (req: Request) => {
  const sessionId = await getOrCreateVisitorSessionId(clientIp(req));
  const state = await getVisitorState(sessionId);
  return json({
    ...state,
    candidateEmail: await getCandidateEmailState(sessionId),
    restoredSession: Boolean((await findGuestCredential((await cookies()).get("nl_visitor")?.value))?.migrated),
    marketingScope: marketingScope(sessionId),
    limits: {
      maxFiles: uploadConfig.maxFilesPerSubmission,
      maxFileSizeBytes: uploadConfig.maxFileSizeBytes,
      types: uploadConfig.screenshotTypes,
    },
  });
});
