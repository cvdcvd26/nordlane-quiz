import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { postAdminMessage } from "@/server/services/admin";
import { rateLimit } from "@/server/rate-limit";
import { leadIdFrom } from "../../lead-id";

export const POST = route("admin.message", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/messages">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-msg:${admin.id}`, 60, 60);
  const messages = await postAdminMessage(leadIdFrom((await ctx.params).id), await readJson(req));
  return json({ messages }, 201);
});
