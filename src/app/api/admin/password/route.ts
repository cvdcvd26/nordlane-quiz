import { route, json, assertSameOrigin, readJson, clientIp } from "@/server/http";
import { requireAdmin, changePassword } from "@/server/admin-auth";

export const POST = route("admin.password", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await changePassword(admin.id, await readJson(req), clientIp(req));
  return json({ ok: true });
});
