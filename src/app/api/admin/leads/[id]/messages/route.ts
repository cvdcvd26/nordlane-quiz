import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { postAdminMessage, getLeadSessionId } from "@/server/services/admin";
import { getConversationBySession, loadMessagePage, loadMessageChanges, messageQuerySchema } from "@/server/services/chat";
import { rateLimit } from "@/server/rate-limit";
import { leadIdFrom } from "../../lead-id";
import { AppError } from "@/server/errors";
import { ZodError } from "zod";

export const GET = route("admin.messages", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/messages">) => {
  await requireAdmin();
  const sessionId = await getLeadSessionId(leadIdFrom((await ctx.params).id));
  const conv = await getConversationBySession(sessionId);
  const query = messageQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return json(conv ? {
    ...(await loadMessagePage(conv.id, query)),
    changes: await loadMessageChanges(conv.id, conv.messageRevision, query.changesAfter),
  } : { messages: [], hasMore: false, nextCursor: null, previousCursor: null, changes: { updates: [], deletedIds: [], cursor: "0", hasMore: false } });
});

export const POST = route("admin.message", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/messages">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-msg:${admin.id}`, 60, 60);
  const input = await readJson(req, 64 * 1024);
  try {
    const messages = await postAdminMessage(leadIdFrom((await ctx.params).id), input);
    return json({ messages }, 201);
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    console.warn("messages.send_failed");
    throw new AppError(500, "message_send_failed", "The message could not be sent. Please try again.");
  }
});
