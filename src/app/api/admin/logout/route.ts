import { route, json, assertSameOrigin } from "@/server/http";
import { logout } from "@/server/admin-auth";

export const POST = route("admin.logout", async (req: Request) => {
  assertSameOrigin(req);
  await logout();
  return json({ ok: true });
});
