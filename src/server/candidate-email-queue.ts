import "server-only";
import { send } from "@vercel/queue";
import { Client } from "@upstash/qstash";
import { candidateSiteUrl } from "./brevo";

export const CANDIDATE_EMAIL_TOPIC = "alleybiz-candidate-emails";
export const EMAIL_QUEUE_RETENTION_SECONDS = 7 * 24 * 3600;
export interface CandidateEmailQueue { schedule(id: string, dueAt: Date): Promise<void> }
let current: CandidateEmailQueue | null = null;
export const setCandidateEmailQueue = (next: CandidateEmailQueue | null) => { current = next; };

const production: CandidateEmailQueue = {
  async schedule(id, dueAt) {
    const delaySeconds = Math.max(0, Math.ceil((dueAt.getTime() - Date.now()) / 1000));
    if (!Number.isFinite(delaySeconds) || delaySeconds >= EMAIL_QUEUE_RETENTION_SECONDS) throw new Error("email_schedule_range");
    const key = `email-${id}-${dueAt.getTime()}`;
    if (process.env.VERCEL) {
      await send(CANDIDATE_EMAIL_TOPIC, { emailJobId: id }, {
        delaySeconds, retentionSeconds: EMAIL_QUEUE_RETENTION_SECONDS, idempotencyKey: key,
      });
      return;
    }
    if (!process.env.QSTASH_TOKEN) throw new Error("email_queue_unconfigured");
    const client = new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL || undefined });
    await client.publishJSON({
      url: `${candidateSiteUrl()}/api/jobs/candidate-email-deliver`, body: { emailJobId: id },
      notBefore: Math.ceil(dueAt.getTime() / 1000), deduplicationId: key, retries: 5,
    });
  },
};
export const candidateEmailQueue = () => current ?? production;
