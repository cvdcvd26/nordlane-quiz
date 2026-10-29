import { requireAdmin } from "@/server/admin-auth";
import { readBody } from "@/server/body";
import { AppError, badRequest } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getQuickReplies, updateQuickReplies } from "@/server/services/quick-replies";
import { ZodError } from "zod";

export const GET = route("admin.quick-replies", async () => {
  await requireAdmin();
  return json(await getQuickReplies());
});

export const PUT = route("admin.quick-replies.put", async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`quick-replies:${admin.id}`, 30, 60);
  let input: unknown;
  try { input = JSON.parse((await readBody(req, 384 * 1024)).toString("utf8")); }
  catch (error) {
    if (error instanceof SyntaxError) throw badRequest("Invalid JSON.");
    throw error;
  }
  try { return json(await updateQuickReplies(input)); }
  catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    console.warn("quick_replies.save_failed");
    throw new AppError(500, "quick_replies_save_failed", "The templates could not be saved. Please try again.");
  }
});
