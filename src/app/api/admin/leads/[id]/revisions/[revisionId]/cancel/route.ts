import { route, json, assertSameOrigin } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { cancelTaskRevision } from "@/server/services/task-revisions";
import { rateLimit } from "@/server/rate-limit";
import { leadIdFrom } from "../../../../lead-id";

export const POST = route("admin.revisions.cancel", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/revisions/[revisionId]/cancel">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-revision:${admin.id}`, 30, 60);
  const { id, revisionId } = await ctx.params;
  return json({ revision: await cancelTaskRevision(leadIdFrom(id), revisionId) });
});
