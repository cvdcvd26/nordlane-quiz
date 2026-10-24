import { requireAdmin } from "@/server/admin-auth";
import { json, route } from "@/server/http";
import { listReminders } from "@/server/services/reminders";

export const GET = route("admin.reminders", async (req: Request) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  return json(await listReminders({ filter: params.get("filter") ?? "due", offset: params.get("offset") ?? 0 }));
});
