import { z, ZodError } from "zod";
import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { rateLimit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { richTextSchema } from "@/lib/rich-text";
import { translateDraft, translateIncoming } from "@/server/services/translations";
import { leadIdFrom } from "../../lead-id";

export const maxDuration = 180;

const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("incoming"), messageIds: z.array(z.string().uuid()).min(1).max(20), cacheOnly: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("draft"), body: z.string().trim().min(1).max(4000), bodyRich: richTextSchema.nullable().optional() }).strict(),
]);

export const POST = route("admin.translation", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/translations">) => {
  assertSameOrigin(req);
  const admin = await requireAdmin();
  await rateLimit(`admin-translation:${admin.id}`, 60, 60);
  const leadId = leadIdFrom((await ctx.params).id);
  const input = requestSchema.parse(await readJson(req, 64 * 1024));
  try {
    return json(input.kind === "incoming"
      ? await translateIncoming(leadId, input.messageIds, { cacheOnly: input.cacheOnly })
      : await translateDraft(leadId, input.body, input.bodyRich));
  } catch (error) {
    if (error instanceof AppError || error instanceof ZodError) throw error;
    console.warn("translation.request_failed");
    throw new AppError(503, "translation_unavailable", "Translation is temporarily unavailable.");
  }
});
