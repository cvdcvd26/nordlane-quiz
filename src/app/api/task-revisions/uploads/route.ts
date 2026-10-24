import { route, json, assertSameOrigin } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { readUploadedFile } from "@/server/multipart";
import { uploadRevisionFile } from "@/server/services/task-revisions";
import { rateLimit } from "@/server/rate-limit";

export const POST = route("revisions.upload", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`revision-upload:${sessionId}`, 40, 10 * 60);
  const { file, fields } = await readUploadedFile(req);
  const revisionId = fields.get("revisionId");
  return json({ file: await uploadRevisionFile(sessionId, typeof revisionId === "string" ? revisionId : "", file) }, 201);
});
