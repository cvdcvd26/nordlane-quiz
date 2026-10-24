import { requireAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { deleteReminder, updateReminder } from "@/server/services/reminders";
import { leadIdFrom } from "../../../lead-id";

export const PATCH = route("admin.reminders.update", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/reminders/[reminderId]">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`reminders:${admin.id}`, 60, 60);
  const { id, reminderId } = await ctx.params;
  return json({ reminder: await updateReminder(leadIdFrom(id), reminderId, await readJson(req)) });
});
export const DELETE = route("admin.reminders.delete", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/reminders/[reminderId]">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`reminders:${admin.id}`, 60, 60);
  const { id, reminderId } = await ctx.params;
  return json(await deleteReminder(leadIdFrom(id), reminderId, await readJson(req)));
});
