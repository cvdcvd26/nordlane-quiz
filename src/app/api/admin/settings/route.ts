import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { getSettings, updateSettings } from "@/server/settings";

export const GET = route("admin.settings", async () => {
  await requireAdmin();
  return json({ settings: await getSettings() });
});

export const PUT = route("admin.settings.put", async (req: Request) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json({ settings: await updateSettings(await readJson(req)) });
});
