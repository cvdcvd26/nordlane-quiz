import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const leadStatus = pgEnum("lead_status", ["new", "in_progress", "awaiting_reply", "completed", "rejected"]);
export const messageSender = pgEnum("message_sender", ["visitor", "admin", "system"]);
export const scheduledStatus = pgEnum("scheduled_status", ["pending", "sending", "sent", "failed", "cancelled"]);
export const fileOwner = pgEnum("file_owner", ["visitor", "admin"]);
export const filePurpose = pgEnum("file_purpose", ["submission", "chat"]);

/* ---------- Administrators ---------- */
export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Increased on password change: invalidates every existing admin session.
  tokenVersion: integer("token_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ---------- Rate limiting (fixed window) ---------- */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/* ---------- Visitors ---------- */
export const visitorSessions = pgTable("visitor_sessions", {
  id: id(),
  // SHA-256 of the cookie token; the raw token never reaches the database.
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAnswers = pgTable(
  "quiz_answers",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    answer: text("answer").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("quiz_answers_session_question_uq").on(t.sessionId, t.questionKey)],
);

export const taskSubmissions = pgTable(
  "task_submissions",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    /** The worker's written review, sent together with the screenshots. */
    review: text("review"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("task_submissions_session_uq").on(t.sessionId),
    uniqueIndex("task_submissions_idem_uq").on(t.idempotencyKey),
  ],
);

/** Contact details from the first screen. One row per visitor session. */
export const visitorContacts = pgTable(
  "visitor_contacts",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // E.164, e.g. +48600123456
    phone: text("phone").notNull(),
    // "@username" or null
    telegram: text("telegram"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("visitor_contacts_session_uq").on(t.sessionId),
    index("visitor_contacts_phone_idx").on(t.phone),
    check("visitor_contacts_name_nonempty", sql`length(btrim(${t.name})) > 0`),
  ],
);

/* ---------- Conversations & messages ---------- */
export const leads = pgTable(
  "leads",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    status: leadStatus("status").notNull().default("new"),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("leads_session_uq").on(t.sessionId),
    index("leads_status_idx").on(t.status),
    index("leads_created_idx").on(t.createdAt),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    leadId: bigint("lead_id", { mode: "number" }).references(() => leads.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("conversations_session_uq").on(t.sessionId), uniqueIndex("conversations_lead_uq").on(t.leadId)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    sender: messageSender("sender").notNull(),
    body: text("body").notNull().default(""),
    // Client-generated id: retries of the same send never create a second message.
    clientMessageId: text("client_message_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_client_id_uq").on(t.conversationId, t.clientMessageId),
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  ],
);

/* ---------- Files ---------- */
export const files = pgTable(
  "files",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => visitorSessions.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => taskSubmissions.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    purpose: filePurpose("purpose").notNull(),
    uploadedBy: fileOwner("uploaded_by").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("files_session_idx").on(t.sessionId),
    index("files_submission_idx").on(t.submissionId),
    index("files_message_idx").on(t.messageId),
  ],
);

/* ---------- Scheduled (delayed) messages ---------- */
export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: id(),
    submissionId: uuid("submission_id").notNull().references(() => taskSubmissions.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: scheduledStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    queueMessageId: text("queue_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("scheduled_messages_submission_uq").on(t.submissionId),
    index("scheduled_messages_due_idx").on(t.status, t.scheduledFor),
  ],
);

/* ---------- Admin notes & settings ---------- */
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: id(),
    leadId: bigint("lead_id", { mode: "number" }).notNull().references(() => leads.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lead_notes_lead_idx").on(t.leadId), check("lead_notes_body_nonempty", sql`length(btrim(${t.body})) > 0`)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

/* ---------- Relations ---------- */
export const leadsRelations = relations(leads, ({ one, many }) => ({
  session: one(visitorSessions, { fields: [leads.sessionId], references: [visitorSessions.id] }),
  notes: many(leadNotes),
}));
export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  files: many(files),
}));
export const filesRelations = relations(files, ({ one }) => ({
  message: one(messages, { fields: [files.messageId], references: [messages.id] }),
  submission: one(taskSubmissions, { fields: [files.submissionId], references: [taskSubmissions.id] }),
}));
export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
}));
