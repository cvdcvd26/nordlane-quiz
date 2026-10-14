import { z } from "zod";
import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { listLeads } from "@/server/services/admin";
import { deleteLeads } from "@/server/services/leads";

export const GET = route("admin.leads", async (req: Request) => {
  await requireAdmin();
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return json(await listLeads(params));
});

/** Bulk delete: { ids: number[] } */
export const DELETE = route("admin.leads.delete", async (req: Request) => {
  assertSameOrigin(req);
  await requireAdmin();
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(await readJson(req));
  return json(await deleteLeads(ids));
});
