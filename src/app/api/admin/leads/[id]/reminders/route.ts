import { requireAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { createReminder, listReminders } from "@/server/services/reminders";
import { leadIdFrom } from "../../lead-id";

export const GET = route("admin.reminders.lead", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/reminders">) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  return json(await listReminders({ filter: params.get("filter") ?? "all", offset: params.get("offset") ?? 0 }, leadIdFrom((await ctx.params).id)));
});
export const POST = route("admin.reminders.create", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/reminders">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`reminders:${admin.id}`, 60, 60);
  return json({ reminder: await createReminder(leadIdFrom((await ctx.params).id), admin.id, await readJson(req)) }, 201);
});
