import { requireAdmin, requirePermanentAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { getMaintenanceState, updateMaintenance } from "@/server/maintenance";

function privateResponse(data: unknown) {
  const response = json(data);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = route("admin.maintenance", async () => {
  const admin = await requireAdmin();
  if (admin.isTemporary) return privateResponse({ canManage: false });
  return privateResponse({ canManage: true, ...await getMaintenanceState() });
});

export const PUT = route("admin.maintenance.put", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requirePermanentAdmin();
  return privateResponse({ canManage: true, ...await updateMaintenance(admin.id, await readJson(req)) });
});
