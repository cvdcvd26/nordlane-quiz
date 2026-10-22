import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadDetails, updateLeadStatus } from "@/server/services/admin";
import { deleteLeads } from "@/server/services/leads";
import { leadIdFrom } from "../lead-id";
import { changeCursorSchema } from "@/server/services/chat";

export const GET = route("admin.lead", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]">) => {
  await requireAdmin();
  const changesAfter = changeCursorSchema.optional().parse(new URL(req.url).searchParams.get("changesAfter") ?? undefined);
  return json(await getLeadDetails(leadIdFrom((await ctx.params).id), changesAfter));
});

export const PATCH = route("admin.lead.patch", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const id = leadIdFrom((await ctx.params).id);
  await updateLeadStatus(id, await readJson(req));
  return json(await getLeadDetails(id));
});

export const DELETE = route("admin.lead.delete", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]">) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json(await deleteLeads([leadIdFrom((await ctx.params).id)]));
});
