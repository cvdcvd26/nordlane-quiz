import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getLeadDetails, getLeadSessionId, updateCandidateOutcome } from "@/server/services/admin";
import { purgeTerminalRevisionFiles } from "@/server/services/task-revisions";
import { leadIdFrom } from "../../lead-id";

export const POST = route("admin.lead.outcome", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/outcome">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const id = leadIdFrom((await ctx.params).id);
  await updateCandidateOutcome(id, await readJson(req));
  // The outcome is already committed. Storage retries must never turn a published result into an apparent failure.
  await purgeTerminalRevisionFiles(30, await getLeadSessionId(id)).catch(() => {});
  return json(await getLeadDetails(id));
});
