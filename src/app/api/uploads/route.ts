import { route, json, assertSameOrigin } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { readUploadedFile } from "@/server/multipart";
import { uploadFile } from "@/server/services/uploads";
import { rateLimit } from "@/server/rate-limit";
import { getSettings } from "@/server/settings";
import { badRequest } from "@/server/errors";
import { content } from "@/config/content";

/** Visitor upload: screenshots for the task (purpose=submission) or a chat attachment (purpose=chat). */
export const POST = route("uploads", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`upload:${sessionId}`, 40, 10 * 60);
  const { file, fields } = await readUploadedFile(req);
  const purpose = fields.get("purpose") === "chat" ? "chat" : "submission";
  if (purpose === "chat" && !(await getSettings()).chatAttachmentsEnabled) throw badRequest(content.errors.attachmentsDisabled);
  const saved = await uploadFile({ sessionId, purpose, uploadedBy: "visitor", file });
  return json({ file: saved }, 201);
});
