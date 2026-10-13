import { route, json, assertSameOrigin, readJson, clientIp } from "@/server/http";
import { login } from "@/server/admin-auth";

export const POST = route("admin.login", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await login(await readJson(req), clientIp(req));
  return json({ admin });
});
