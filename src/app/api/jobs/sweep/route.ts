import { json } from "@/server/http";
import { deliverOverdue } from "@/server/services/delivery";
import { log } from "@/server/log";
import { purgeDeletedMessageFiles } from "@/server/services/message-management";
import { purgeTerminalRevisionFiles } from "@/server/services/task-revisions";

/**
 * Safety net run by Vercel Cron (vercel.json): delivers scheduled messages that are overdue,
 * e.g. if enqueueing in QStash failed at submit time. Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);
  const results = await deliverOverdue({ limit: 100 });
  const attachments = await purgeDeletedMessageFiles();
  const revisionAttachments = await purgeTerminalRevisionFiles();
  log.info("scheduler", "sweep finished", { count: Object.keys(results).length });
  return json({ results, attachments, revisionAttachments });
}
