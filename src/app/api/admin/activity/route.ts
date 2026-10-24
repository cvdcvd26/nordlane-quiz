import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { adminActivity } from "@/server/services/leads";
import { reminderActivity } from "@/server/services/reminders";

/** New leads and visitor messages after `since` (ISO). Polled by the admin panel for sound + toasts. */
export const GET = route("admin.activity", async (req: Request) => {
  await requireAdmin();
  const raw = new URL(req.url).searchParams.get("since");
  const parsed = raw ? new Date(raw) : null;
  const now = new Date();
  // Never look back more than 10 minutes, so a stale tab does not replay old events.
  const floor = new Date(now.getTime() - 10 * 60_000);
  const since = parsed && !Number.isNaN(parsed.getTime()) && parsed > floor ? parsed : floor;
  const [activity, reminders] = await Promise.all([adminActivity(since), reminderActivity(since, now)]);
  return json({ ...activity, ...reminders, now: now.toISOString() });
});
