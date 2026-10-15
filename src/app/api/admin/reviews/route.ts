import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { listReviews } from "@/server/services/admin";

export const GET = route("admin.reviews", async (req: Request) => {
  await requireAdmin();
  return json(await listReviews(Object.fromEntries(new URL(req.url).searchParams.entries())));
});
