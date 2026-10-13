import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadDetails, updateLeadStatus } from "@/server/services/admin";
import { leadIdFrom } from "../lead-id";

export const GET = route("admin.lead", async (_req: Request, ctx: RouteContext<"/api/admin/leads/[id]">) => {
  await requireAdmin();
  return json(await getLeadDetails(leadIdFrom((await ctx.params).id)));
});

export const PATCH = route("admin.lead.patch", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const id = leadIdFrom((await ctx.params).id);
  await updateLeadStatus(id, await readJson(req));
  return json(await getLeadDetails(id));
});
