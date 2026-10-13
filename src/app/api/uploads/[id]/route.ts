import { route, json, assertSameOrigin } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { deletePendingFile } from "@/server/services/uploads";

export const DELETE = route("uploads.delete", async (req: Request, ctx: RouteContext<"/api/uploads/[id]">) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  const { id } = await ctx.params;
  await deletePendingFile(sessionId, id);
  return json({ ok: true });
});
