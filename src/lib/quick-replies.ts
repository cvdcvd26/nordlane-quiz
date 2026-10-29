import { z } from "zod";
import { normalizeRichTextContent, richTextSchema } from "@/lib/rich-text";

export const QUICK_REPLY_LIMITS = { count: 12, title: 60, body: 2000 } as const;
export const quickReplySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(QUICK_REPLY_LIMITS.title),
  body: z.string().trim().min(1).max(QUICK_REPLY_LIMITS.body),
  bodyRich: richTextSchema.nullable().optional(),
}).strict().superRefine((reply, ctx) => {
  try { normalizeRichTextContent(reply.body, reply.bodyRich, QUICK_REPLY_LIMITS.body); }
  catch { ctx.addIssue({ code: "custom", path: ["bodyRich"], message: "Formatting must match the reply text." }); }
}).transform(reply => {
  const normalized = normalizeRichTextContent(reply.body, reply.bodyRich, QUICK_REPLY_LIMITS.body);
  return { ...reply, body: normalized.body, ...(reply.bodyRich === undefined ? {} : { bodyRich: normalized.bodyRich }) };
});
export const quickRepliesSchema = z.array(quickReplySchema).max(QUICK_REPLY_LIMITS.count)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate quick reply IDs.");
export const quickRepliesUpdateSchema = z.object({
  revision: z.string().uuid().nullable(),
  replies: quickRepliesSchema,
}).strict();
export type QuickReply = z.infer<typeof quickReplySchema>;
export type QuickReplies = { revision: string | null; replies: QuickReply[] };

/** Drafts are always Polish, regardless of the administrator's interface language. */
export const defaultQuickReplies: QuickReply[] = [
  { id: "received", title: "Potwierdzenie wiadomości", body: "Dziękujemy za wiadomość. Sprawdzimy przesłane informacje i odpowiemy w tym czacie." },
  { id: "screenshots", title: "Uzupełnienie zrzutów ekranu", body: "Prosimy o uzupełnienie zadania o brakujące zrzuty ekranu zgodnie z instrukcją PDF." },
  { id: "details", title: "Doprecyzowanie problemu", body: "Prosimy o doprecyzowanie, na którym kroku pojawił się problem i co było widoczne na ekranie." },
];
