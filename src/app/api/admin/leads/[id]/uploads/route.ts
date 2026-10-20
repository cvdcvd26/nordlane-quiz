import { z } from "zod";
import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadSessionId } from "@/server/services/admin";
import { uploadFile, deletePendingFile } from "@/server/services/uploads";
import { readUploadedFile } from "@/server/multipart";
import { rateLimit } from "@/server/rate-limit";
import { leadIdFrom } from "../../lead-id";

/** Admin attachment for a reply. Linked to the lead's session, visible to the visitor only once sent. */
export const POST = route("admin.upload", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/uploads">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-upload:${admin.id}`, 60, 10 * 60);
  const sessionId = await getLeadSessionId(leadIdFrom((await ctx.params).id));
  const { file } = await readUploadedFile(req);
  return json({ file: await uploadFile({ sessionId, purpose: "chat", uploadedBy: "admin", file }) }, 201);
});

export const DELETE = route("admin.upload.delete", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/uploads">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const sessionId = await getLeadSessionId(leadIdFrom((await ctx.params).id));
  const { fileId } = z.object({ fileId: z.uuid() }).parse(await readJson(req));
  await deletePendingFile(sessionId, fileId, "admin");
  return json({ ok: true });
});
