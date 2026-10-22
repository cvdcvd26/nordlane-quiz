import { requireAdmin } from "@/server/admin-auth";
import { readBody } from "@/server/body";
import { badRequest } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getQuickReplies, updateQuickReplies } from "@/server/services/quick-replies";

export const GET = route("admin.quick-replies", async () => {
  await requireAdmin();
  return json(await getQuickReplies());
});

export const PUT = route("admin.quick-replies.put", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`quick-replies:${admin.id}`, 30, 60);
  let input: unknown;
  try { input = JSON.parse((await readBody(req, 128 * 1024)).toString("utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) throw badRequest("Invalid JSON.");
    throw error;
  }
  return json(await updateQuickReplies(input));
});
