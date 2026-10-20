import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadDetails, updateCandidateOutcome } from "@/server/services/admin";
import { leadIdFrom } from "../../lead-id";

export const POST = route("admin.lead.outcome", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/outcome">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const id = leadIdFrom((await ctx.params).id);
  await updateCandidateOutcome(id, await readJson(req));
  return json(await getLeadDetails(id));
});
