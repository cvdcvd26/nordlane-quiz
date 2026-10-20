import { requirePermanentAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, route } from "@/server/http";
import { deleteTestAccount } from "@/server/services/test-access";

export const DELETE = route("admin.test-access.delete", async (req: Request, ctx: RouteContext<"/api/admin/test-access/[id]">) => {
  assertSameOrigin(req);
  const admin = await requirePermanentAdmin();
  const response = json(await deleteTestAccount(admin.id, (await ctx.params).id));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
