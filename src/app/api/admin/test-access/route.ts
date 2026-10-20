import { z } from "zod";
import { requireAdmin, requirePermanentAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { createTestAccount, listTestAccounts } from "@/server/services/test-access";

function privateResponse(data: unknown, status = 200) {
  const response = json(data, status);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = route("admin.test-access.list", async () => {
  const admin = await requireAdmin();
  return privateResponse({
    canManage: !admin.isTemporary,
    accounts: admin.isTemporary ? [] : await listTestAccounts(admin.id),
  });
});

export const POST = route("admin.test-access.create", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requirePermanentAdmin();
  z.object({}).strict().parse(await readJson(req));
  return privateResponse(await createTestAccount(admin.id), 201);
});
