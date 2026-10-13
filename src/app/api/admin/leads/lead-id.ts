import { notFound } from "@/server/errors";
import { content } from "@/config/content";

export function leadIdFrom(raw: string) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound(content.admin.lead.notFound);
  return n;
}
