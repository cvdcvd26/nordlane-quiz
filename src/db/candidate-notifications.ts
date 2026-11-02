import { sql } from "drizzle-orm";
import { pgTable, uuid, text, bigint, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { candidateAccounts, visitorSessions } from "./schema";

/** Monotonic server-side reading/notification cursors; contains no message text. */
export const candidateEmailState = pgTable("candidate_email_state", {
  sessionId: uuid("session_id").primaryKey().references(() => visitorSessions.id, { onDelete: "cascade" }),
  lastReadSequence: bigint("last_read_sequence", { mode: "bigint" }).notNull().default(sql`0`),
  lastNotifiedSequence: bigint("last_notified_sequence", { mode: "bigint" }).notNull().default(sql`0`),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
});

/** Durable outbox. Neither recipients nor message content are copied here. */
export const candidateEmailJobs = pgTable("candidate_email_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => candidateAccounts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  throughSequence: bigint("through_sequence", { mode: "bigint" }),
  attempts: integer("attempts").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("candidate_email_pending_chat_uq").on(t.accountId).where(sql`${t.kind} = 'chat' and ${t.status} = 'pending'`),
  index("candidate_email_jobs_due_idx").on(t.status, t.dueAt),
  check("candidate_email_jobs_kind_ck", sql`${t.kind} in ('welcome', 'chat')`),
  check("candidate_email_jobs_status_ck", sql`${t.status} in ('pending', 'sending', 'sent', 'cancelled', 'failed', 'uncertain')`),
]);

/** One row per logical send, also protects retries after an ambiguous provider timeout. */
export const candidateEmailSends = pgTable("candidate_email_sends", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("reserved"),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("candidate_email_sends_created_idx").on(t.createdAt)]);

/** Serializes the distributed rolling email quota across serverless instances. */
export const candidateEmailBudgetLock = pgTable("candidate_email_budget_lock", {
  key: text("key").primaryKey(),
});
