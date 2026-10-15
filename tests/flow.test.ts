import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setupTestEnv, newSession, PNG, JPG, PDF, EXE } from "./helpers";
import { schema } from "@/db";
import { saveAnswer, getVisitorState } from "@/server/services/quiz";
import { saveContact } from "@/server/services/contact";
import { uploadFile, deletePendingFile, getReadableFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage, deliverOverdue } from "@/server/services/delivery";
import { getVisitorChat, postVisitorMessage } from "@/server/services/chat";
import { listLeads, listReviews, getLeadDetails, postAdminMessage, addLeadNote, updateLeadStatus } from "@/server/services/admin";
import { deleteLeads, adminActivity } from "@/server/services/leads";
import { updateSettings, getSettings, pickDelayMs } from "@/server/settings";
import { defaultSettings } from "@/config/settings";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => {
  env = await setupTestEnv();
});

const png = (name = "shot.png") => ({ name, type: "image/png", buffer: PNG });

const answerAll = async (sid: string, v = "yes") => {
  for (const k of ["q1", "q2", "q3"]) await saveAnswer(sid, k, v);
};
const REVIEW = "Zadanie było jasne, wszystko działa.";
const contact = { name: "Anna", phone: "600 123 456", telegram: "" };

async function submittedVisitor() {
  const sid = await newSession(env.db);
  await saveContact(sid, contact);
  await answerAll(sid);
  const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
  const res = await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW });
  const [sched] = await env.db
    .select()
    .from(schema.scheduledMessages)
    .where(eq(schema.scheduledMessages.submissionId, res.submissionId));
  return { sid, res, sched };
}

describe("quiz", () => {
  it("stores Tak/Nie and restores the answer when navigating", async () => {
    const sid = await newSession(env.db);
    await answerAll(sid);
    expect((await getVisitorState(sid)).answers).toEqual({ q1: "yes", q2: "yes", q3: "yes" });
    await saveAnswer(sid, "q2", "no");
    expect((await getVisitorState(sid)).answers).toEqual({ q1: "yes", q2: "no", q3: "yes" });
    await expect(saveAnswer(sid, "q1", "maybe")).rejects.toThrow();
    await expect(saveAnswer(sid, "q9", "yes")).rejects.toThrow();
  });
});

describe("file uploads", () => {
  it("accepts several screenshots and stores them", async () => {
    const sid = await newSession(env.db);
    const a = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png("a.png") });
    const b = await uploadFile({
      sessionId: sid,
      purpose: "submission",
      uploadedBy: "visitor",
      file: { name: "b.jpg", type: "image/jpeg", buffer: JPG },
    });
    expect((await getVisitorState(sid)).files.map((f) => f.id)).toEqual([a.id, b.id]);
    const [row] = await env.db.select().from(schema.files).where(eq(schema.files.id, a.id));
    expect(env.blobs.has(row.storageKey)).toBe(true);
    expect(row.storageKey).not.toContain("a.png"); // safe storage name
  });

  it("rejects invalid files: spoofed type, PDF instead of screenshot, too many files", async () => {
    const sid = await newSession(env.db);
    const up = (file: { name: string; type: string; buffer: Buffer }) =>
      uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file });
    await expect(up({ name: "virus.png", type: "image/png", buffer: EXE })).rejects.toThrow(/Zawartość pliku/);
    await expect(up({ name: "doc.pdf", type: "application/pdf", buffer: PDF })).rejects.toThrow(/typ pliku/);
    await expect(up({ name: "fake.jpg", type: "image/jpeg", buffer: PNG })).rejects.toThrow(/Zawartość pliku/);
    for (let i = 0; i < 6; i++) await up(png());
    await expect(up(png())).rejects.toThrow(/maksymalnie/);
  });

  it("deletes a file before submission", async () => {
    const sid = await newSession(env.db);
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    await deletePendingFile(sid, f.id);
    expect((await getVisitorState(sid)).files).toHaveLength(0);
  });
});

describe("task submission", () => {
  it("saves the task and schedules a job 20–30 minutes later", async () => {
    const { sid, res, sched } = await submittedVisitor();
    expect(res.duplicate).toBe(false);
    const state = await getVisitorState(sid);
    expect(state.submission?.id).toBe(res.submissionId);
    expect(state.files).toHaveLength(1);

    const delay = sched.scheduledFor.getTime() - new Date(res.submittedAt).getTime();
    expect(delay).toBeGreaterThanOrEqual(20 * 60_000);
    expect(delay).toBeLessThanOrEqual(30 * 60_000);
    expect(env.queued.some((q) => q.id === sched.id && q.at.getTime() === sched.scheduledFor.getTime())).toBe(true);
    expect(sched.queueMessageId).toBeTruthy();
  });

  it("a repeated click does not create a duplicate", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, contact);
    await answerAll(sid, "no");
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    const key = randomUUID();
    const [r1, r2] = await Promise.all([
      submitTask(sid, { idempotencyKey: key, fileIds: [f.id], review: REVIEW }),
      submitTask(sid, { idempotencyKey: key, fileIds: [f.id], review: REVIEW }),
    ]);
    expect(r1.submissionId).toBe(r2.submissionId);
    const subs = await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, sid));
    expect(subs).toHaveLength(1);
  });

  it("requires a written review and shows it to the admin; the review is searchable", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, contact);
    await answerAll(sid);
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    await expect(submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id] })).rejects.toThrow(/opinię/);
    await expect(submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: "  krótko " })).rejects.toThrow(/opinię/);
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: "  Unikalna opinia o zadaniu zebra  " });
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    expect((await getLeadDetails(lead.id)).submission?.review).toBe("Unikalna opinia o zadaniu zebra");
    expect((await listLeads({ q: "zebra" })).items.map((i) => i.id)).toEqual([lead.id]);

    const reviews = await listReviews({ q: "zebra" });
    expect(reviews.total).toBe(1);
    expect(reviews.items[0]).toMatchObject({ leadId: lead.id, name: "Anna", review: "Unikalna opinia o zadaniu zebra", status: "new" });
    expect((await listReviews({ q: "Anna" })).total).toBeGreaterThanOrEqual(1);
    expect((await listReviews({ q: "nie-ma-takiej-opinii" })).total).toBe(0);
  });

  it("is not submitted without contact details, without all answers, or with a foreign file", async () => {
    const sid = await newSession(env.db);
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    await expect(submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW })).rejects.toThrow(/dane kontaktowe/);
    await saveContact(sid, contact);
    await saveAnswer(sid, "q1", "yes"); // only one of three answers
    await expect(submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW })).rejects.toThrow(/wszystkie pytania/);

    const other = await newSession(env.db);
    await saveContact(other, contact);
    await answerAll(other);
    await expect(submitTask(other, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW })).rejects.toThrow(/części plików/);
    expect(await env.db.select().from(schema.taskSubmissions).where(eq(schema.taskSubmissions.sessionId, other))).toHaveLength(0);
  });

  it("if the queue is down, the job stays in the DB and the backup sweep delivers it", async () => {
    env.queue.failNext = true;
    const { sched } = await submittedVisitor();
    expect(sched.status).toBe("pending");
    const [row] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, sched.id));
    expect(row.lastError).toMatch(/enqueue failed/);
    const later = new Date(sched.scheduledFor.getTime() + 2 * 60_000);
    const res = await deliverOverdue({ now: later });
    expect(res[sched.id]).toBe("sent");
  });
});

describe("automatic message", () => {
  it("is not sent early, is sent once, retries create no duplicates", async () => {
    const { sched } = await submittedVisitor();
    expect(await deliverScheduledMessage(sched.id, new Date(sched.scheduledFor.getTime() - 5 * 60_000))).toBe("not_due");

    const at = new Date(sched.scheduledFor.getTime() + 1000);
    const outcomes = await Promise.all([1, 2, 3].map(() => deliverScheduledMessage(sched.id, at)));
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(await deliverScheduledMessage(sched.id, at)).toBe("already_sent");

    const msgs = await env.db.select().from(schema.messages).where(eq(schema.messages.conversationId, sched.conversationId));
    expect(msgs.filter((m) => m.sender === "system")).toHaveLength(1);
    expect(msgs[0].body).toBe(defaultSettings.autoMessageText);
    const [row] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.id, sched.id));
    expect(row.status).toBe("sent");
    expect(row.sentAt).toBeTruthy();
  });

  it("random delay always stays within the configured range", () => {
    for (let i = 0; i < 1000; i++) {
      const d = pickDelayMs({ autoMessageMinDelayMinutes: 20, autoMessageMaxDelayMinutes: 30 });
      expect(d).toBeGreaterThanOrEqual(20 * 60_000);
      expect(d).toBeLessThanOrEqual(30 * 60_000);
    }
  });

  it("disabling it in settings cancels delivery", async () => {
    const { sched } = await submittedVisitor();
    await updateSettings({ ...(await getSettings()), autoMessageEnabled: false });
    expect(await deliverScheduledMessage(sched.id, new Date(sched.scheduledFor.getTime() + 1000))).toBe("cancelled");
    await updateSettings(defaultSettings);
  });
});

describe("chat and leads", () => {
  it("lead is created right after the contact screen and goes through the stages", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, contact);
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    expect(lead).toBeDefined();
    const stage = async () => (await listLeads({ q: String(lead.id) })).items.find((i) => i.id === lead.id)?.stage;
    expect(await stage()).toBe("questions"); // contact saved → the visitor is on the questions screen

    // Saving the contact again (going back to step 1) does not create a second lead.
    await saveContact(sid, { ...contact, name: "Anna Nowak" });
    expect(await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid))).toHaveLength(1);

    await saveAnswer(sid, "q1", "yes");
    expect(await stage()).toBe("questions");
    await saveAnswer(sid, "q2", "no");
    await saveAnswer(sid, "q3", "yes");
    expect(await stage()).toBe("task");
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW });
    expect(await stage()).toBe("submitted");

    const [conv] = await env.db.select().from(schema.conversations).where(eq(schema.conversations.sessionId, sid));
    expect(conv.leadId).toBe(lead.id);
  });

  it("visitor messages go to the existing lead, before and after the auto message, without duplicates", async () => {
    const { sid, sched } = await submittedVisitor();
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));

    const early = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Wczesne pytanie" });
    expect(early.leadId).toBe(lead.id);

    await deliverScheduledMessage(sched.id, new Date(sched.scheduledFor.getTime() + 1000));
    const cid = randomUUID();
    const second = await postVisitorMessage(sid, { clientMessageId: cid, body: "Jeszcze jedno pytanie" });
    const retry = await postVisitorMessage(sid, { clientMessageId: cid, body: "Jeszcze jedno pytanie" });
    expect(second.leadId).toBe(lead.id);
    expect(retry.message.id).toBe(second.message.id);

    const leads = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    expect(leads).toHaveLength(1);
    expect(leads[0].messageCount).toBe(3); // early + system + 1 (retry not counted)

    const chat = await getVisitorChat(sid);
    expect(chat.messages.map((m) => m.sender)).toEqual(["visitor", "system", "visitor"]);
  });

  it("admin can write before the task is sent; the visitor sees it once the chat opens", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, contact);
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "Dzień dobry, jest Pan/Pani?" });
    await expect(getVisitorChat(sid)).rejects.toThrow(); // chat opens after submission
    await answerAll(sid);
    const f = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: png() });
    await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [f.id], review: REVIEW });
    const chat = await getVisitorChat(sid);
    expect(chat.messages.map((m) => m.body)).toContain("Dzień dobry, jest Pan/Pani?");
  });

  it("deleting leads removes all visitor data and stored files", async () => {
    const a = await submittedVisitor();
    const b = await submittedVisitor();
    const leadOf = async (sid: string) => (await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid)))[0].id;
    const [idA, idB] = [await leadOf(a.sid), await leadOf(b.sid)];
    await postVisitorMessage(a.sid, { clientMessageId: randomUUID(), body: "Do usunięcia" });
    await addLeadNote(idA, { body: "notatka" });
    const keys = (await env.db.select().from(schema.files).where(eq(schema.files.sessionId, a.sid))).map((f) => f.storageKey);
    expect(keys.length).toBeGreaterThan(0);
    keys.forEach((k) => expect(env.blobs.has(k)).toBe(true));

    expect(await deleteLeads([idA, 999_999])).toEqual({ deleted: 1 });

    for (const t of [schema.leads, schema.visitorContacts, schema.quizAnswers, schema.taskSubmissions, schema.conversations, schema.files] as const)
      expect(await env.db.select().from(t).where(eq(t.sessionId, a.sid))).toHaveLength(0);
    expect(await env.db.select().from(schema.leadNotes).where(eq(schema.leadNotes.leadId, idA))).toHaveLength(0);
    keys.forEach((k) => expect(env.blobs.has(k)).toBe(false));
    await expect(getLeadDetails(idA)).rejects.toThrow();
    // The other lead is untouched.
    expect((await getLeadDetails(idB)).lead.id).toBe(idB);
  });

  it("activity feed reports new leads and new visitor messages since a moment", async () => {
    const since = new Date(Date.now() - 1000);
    const { sid } = await submittedVisitor();
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Halo?" });
    const act = await adminActivity(since);
    expect(act.leads.some((l) => l.id === lead.id && l.name === "Anna")).toBe(true);
    expect(act.messages.some((m) => m.leadId === lead.id && m.preview === "Halo?")).toBe(true);
    const later = await adminActivity(new Date(Date.now() + 60_000));
    expect(later.leads).toHaveLength(0);
    expect(later.messages).toHaveLength(0);
  });

  it("admin sees files and messages, reply reaches the visitor, notes do not", async () => {
    const { sid, sched } = await submittedVisitor();
    await deliverScheduledMessage(sched.id, new Date(sched.scheduledFor.getTime() + 1000));
    const att = await uploadFile({ sessionId: sid, purpose: "chat", uploadedBy: "visitor", file: png("chat.png") });
    const { leadId } = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Gotowe", fileIds: [att.id] });

    const list = await listLeads({ q: "Gotowe" });
    expect(list.items.some((i) => i.id === leadId && i.answer === "yes,yes,yes" && i.contactName === "Anna" && i.contactPhone === "+48600123456")).toBe(true);
    expect((await listLeads({ status: "new" })).items.some((i) => i.id === leadId)).toBe(true);

    await addLeadNote(leadId!, { body: "Tajna notatka" });
    await updateLeadStatus(leadId!, { status: "in_progress" });
    const pdf = await uploadFile({
      sessionId: sid,
      purpose: "chat",
      uploadedBy: "admin",
      file: { name: "brief.pdf", type: "application/pdf", buffer: PDF },
    });
    // Before it is sent, the admin file is not visible to the visitor.
    expect(await getReadableFile(pdf.id, { sessionId: sid })).toBeNull();
    await postAdminMessage(leadId!, { clientMessageId: randomUUID(), body: "Dziękujemy!", fileIds: [pdf.id] });

    const details = await getLeadDetails(leadId!);
    expect(details.lead.status).toBe("in_progress");
    expect(details.submission?.files).toHaveLength(1);
    expect(details.messages.at(-1)?.files[0]?.name).toBe("brief.pdf");
    expect(details.notes[0].body).toBe("Tajna notatka");

    const chat = await getVisitorChat(sid);
    expect(chat.messages.at(-1)).toMatchObject({ sender: "admin", body: "Dziękujemy!" });
    expect(JSON.stringify(chat)).not.toContain("Tajna notatka");
    expect(await getReadableFile(pdf.id, { sessionId: sid })).not.toBeNull();
  });

  it("a stranger cannot access someone else's files or chat", async () => {
    const { sid } = await submittedVisitor();
    const [file] = await env.db.select().from(schema.files).where(eq(schema.files.sessionId, sid));
    const stranger = await newSession(env.db);
    expect(await getReadableFile(file.id, { sessionId: stranger })).toBeNull();
    expect(await getReadableFile(file.id, { sessionId: sid })).not.toBeNull();
    expect(await getReadableFile(file.id, { admin: true })).not.toBeNull();
    await expect(getVisitorChat(stranger)).rejects.toThrow();
    await expect(postVisitorMessage(stranger, { clientMessageId: randomUUID(), body: "hi" })).rejects.toThrow();
  });
});

describe("contact details", () => {
  it("normalises phone and Telegram, Telegram is optional", async () => {
    const sid = await newSession(env.db);
    expect(await saveContact(sid, { name: "  Jan  ", phone: "0048 512-345-678", telegram: "" })).toEqual({
      name: "Jan",
      phone: "+48512345678",
      telegram: null,
    });
    expect((await saveContact(sid, { name: "Jan", phone: "+48 512 345 678", telegram: "https://t.me/jan_test" })).telegram).toBe("@jan_test");
    expect((await getVisitorState(sid)).contact).toEqual({ name: "Jan", phone: "+48512345678", telegram: "@jan_test" });
  });

  it("rejects an empty name, an invalid Polish number and an invalid Telegram name", async () => {
    const sid = await newSession(env.db);
    await expect(saveContact(sid, { name: "   ", phone: "600123456" })).rejects.toThrow(/Podaj swoje imię/);
    await expect(saveContact(sid, { name: "Jan", phone: "12345" })).rejects.toThrow(/prawidłowy numer telefonu/);
    await expect(saveContact(sid, { name: "Jan", phone: "060 012 345" })).rejects.toThrow(/prawidłowy numer telefonu/);
    await expect(saveContact(sid, { name: "Jan", phone: "600123456", telegram: "ab" })).rejects.toThrow(/Telegram/);
  });

  it("admin search finds leads by name and by phone digits", async () => {
    const { sid, sched } = await submittedVisitor();
    await saveContact(sid, { name: "Zofia Kowalska", phone: "+48 733 222 111" });
    await deliverScheduledMessage(sched.id, new Date(sched.scheduledFor.getTime() + 1000));
    const { leadId } = await postVisitorMessage(sid, { clientMessageId: randomUUID(), body: "Hej" });
    expect((await listLeads({ q: "kowalska" })).items.map((i) => i.id)).toEqual([leadId]);
    expect((await listLeads({ q: "733 222" })).items.map((i) => i.id)).toEqual([leadId]);
    expect((await getLeadDetails(leadId!)).contact).toEqual({ name: "Zofia Kowalska", phone: "+48733222111", telegram: null });
  });
});
