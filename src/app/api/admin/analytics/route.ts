import { requireAdmin } from "@/server/admin-auth";
import { json, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getAnalytics } from "@/server/services/analytics";

export const GET = route("admin.analytics", async (req: Request) => {
  const admin = await requireAdmin();
  await rateLimit(`admin-analytics:${admin.id}`, 60, 60);
  const response = json(await getAnalytics(Object.fromEntries(new URL(req.url).searchParams.entries())));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
