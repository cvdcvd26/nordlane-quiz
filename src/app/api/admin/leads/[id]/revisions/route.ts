import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadRevisions, requestTaskRevision } from "@/server/services/task-revisions";
import { rateLimit } from "@/server/rate-limit";
import { leadIdFrom } from "../../lead-id";

export const GET = route("admin.revisions.get", async (_req: Request, ctx: RouteContext<"/api/admin/leads/[id]/revisions">) => {
  await requireAdmin();
  return json(await getLeadRevisions(leadIdFrom((await ctx.params).id)));
});

export const POST = route("admin.revisions.post", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/revisions">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-revision:${admin.id}`, 30, 60);
  return json({ revision: await requestTaskRevision(leadIdFrom((await ctx.params).id), admin.id, await readJson(req)) }, 201);
});
