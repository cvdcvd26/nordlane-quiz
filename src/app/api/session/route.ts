import { route, json, clientIp } from "@/server/http";
import { getOrCreateVisitorSessionId } from "@/server/visitor-session";
import { getVisitorState } from "@/server/services/quiz";
import { uploadConfig } from "@/config/settings";

/** Creates (or restores) the visitor session and returns everything needed to resume the flow. */
export const GET = route("session", async (req: Request) => {
  const sessionId = await getOrCreateVisitorSessionId(clientIp(req));
  const state = await getVisitorState(sessionId);
  return json({
    ...state,
    limits: {
      maxFiles: uploadConfig.maxFilesPerSubmission,
      maxFileSizeBytes: uploadConfig.maxFileSizeBytes,
      types: uploadConfig.screenshotTypes,
    },
  });
});
