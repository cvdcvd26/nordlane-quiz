import { requireAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { changeAdminMessage } from "@/server/services/message-management";
import { leadIdFrom } from "@/app/api/admin/leads/lead-id";
import { AppError } from "@/server/errors";
import { ZodError } from "zod";

type Context = RouteContext<"/api/admin/leads/[id]/messages/[messageId]">;
async function change(req: Request, ctx: Context, action: "edit" | "delete") {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-message-edit:${admin.id}`, 60, 60);
  const { id, messageId } = await ctx.params;
  const input = await readJson(req);
  try { return json(await changeAdminMessage(leadIdFrom(id), messageId, action, input)); }
  catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    // Database exceptions may contain the old/new message in query parameters.
    console.warn("messages.change_failed");
    throw new AppError(500, "message_change_failed", "The message could not be changed. Please try again.");
  }
}

export const PATCH = route("admin.message.edit", (req: Request, ctx: Context) => change(req, ctx, "edit"));
export const DELETE = route("admin.message.delete", (req: Request, ctx: Context) => change(req, ctx, "delete"));
