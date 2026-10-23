import { replaceMainAdminAccess, requirePermanentAdmin } from "@/server/admin-auth";
import { assertSameOrigin, clientIp, json, readJson, route } from "@/server/http";

export const PUT = route("admin.account", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requirePermanentAdmin();
  return json(await replaceMainAdminAccess(admin.id, await readJson(req), clientIp(req)));
});
