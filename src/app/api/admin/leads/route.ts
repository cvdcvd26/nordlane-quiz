import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { listLeads } from "@/server/services/admin";

export const GET = route("admin.leads", async (req: Request) => {
  await requireAdmin();
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return json(await listLeads(params));
});
