import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { addLeadNote } from "@/server/services/admin";
import { leadIdFrom } from "../../lead-id";

export const POST = route("admin.note", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/notes">) => {
  assertSameOrigin(req);
  await requireAdmin();
  const note = await addLeadNote(leadIdFrom((await ctx.params).id), await readJson(req));
  return json({ note }, 201);
});
