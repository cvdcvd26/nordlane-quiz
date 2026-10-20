import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setupTestEnv, newSession, PNG } from "./helpers";
import { schema } from "@/db";
import { managerProfiles } from "@/config/managers";
import { getSessionManager } from "@/server/services/managers";
import { saveContact } from "@/server/services/contact";
import { ensureLead } from "@/server/services/leads";
import { saveAnswer } from "@/server/services/quiz";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { deliverScheduledMessage } from "@/server/services/delivery";
import { getVisitorChat } from "@/server/services/chat";
import { getLeadDetails, listLeads, postAdminMessage } from "@/server/services/admin";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.client.close(); });
const contact = { name: "Manager assignment test", phone: "600123456" };

describe("persistent HR assignment", () => {
  it("seeds the four supplied manager profiles", async () => {
    const profiles = await env.db.select({ id: schema.managers.id, name: schema.managers.name, avatar: schema.managers.avatar }).from(schema.managers);
    expect(profiles.sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...managerProfiles].sort((a, b) => a.id.localeCompare(b.id)));
  });

  it("chooses a registered manager for a new lead once, including concurrent contact saves", async () => {
    const sid = await newSession(env.db);
    await Promise.all([saveContact(sid, contact), saveContact(sid, contact)]);
    const initial = await getSessionManager(sid);
    expect(managerProfiles).toContainEqual(initial);
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    expect(lead.managerId).toBe(initial.id);
    expect(await ensureLead(env.db, sid)).toBe(lead.id);
    await saveContact(sid, { ...contact, name: "Changed contact name" });
    expect(await getSessionManager(sid)).toEqual(initial);
    expect(await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid))).toHaveLength(1);
  });

  it("uses the database's random selection instead of a hard-coded profile on every insertion path", async () => {
    // With a single registered profile available the random choice must pick it.
    // Roll back the fixture so subsequent tests still use the four seeded profiles.
    for (const expected of managerProfiles) {
      await env.db.transaction(async (tx) => {
        await tx.delete(schema.visitorSessions);
        for (const other of managerProfiles.filter((p) => p.id !== expected.id))
          await tx.delete(schema.managers).where(eq(schema.managers.id, other.id));
        const [session] = await tx.insert(schema.visitorSessions).values({ tokenHash: randomUUID() }).returning();
        const [lead] = await tx.insert(schema.leads).values({ sessionId: session.id }).returning();
        expect(lead.managerId).toBe(expected.id);
        tx.rollback();
      }).catch((error: Error) => {
        // Drizzle's explicit rollback is the only expected failure here.
        if (error.name !== "DrizzleError" || error.message !== "Rollback") throw error;
      });
    }
  });

  it("returns the same HR identity for automatic delivery, admin replies, reloads and admin views", async () => {
    const sid = await newSession(env.db);
    await saveContact(sid, contact);
    const initial = await getSessionManager(sid);
    for (const key of ["q1", "q2", "q3"]) await saveAnswer(sid, key, "yes");
    const image = await uploadFile({ sessionId: sid, purpose: "submission", uploadedBy: "visitor", file: { name: "shot.png", type: "image/png", buffer: PNG } });
    const submission = await submitTask(sid, { idempotencyKey: randomUUID(), fileIds: [image.id], review: "Task verification completed." });
    const [job] = await env.db.select().from(schema.scheduledMessages).where(eq(schema.scheduledMessages.submissionId, submission.submissionId));
    await deliverScheduledMessage(job.id, new Date(job.scheduledFor.getTime() + 1));
    const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sid));
    await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "We received your task." });
    const chat = await getVisitorChat(sid);
    expect(chat.messages.map((m) => m.sender)).toEqual(["system", "admin"]);
    expect(chat.manager).toEqual(initial);
    expect((await getVisitorChat(sid)).manager).toEqual(initial);
    expect((await getLeadDetails(lead.id)).lead.manager).toEqual(initial);
    expect((await listLeads({ q: `#${lead.id}` })).items[0].manager).toEqual(initial);
    await expect(env.db.delete(schema.managers).where(eq(schema.managers.id, initial.id))).rejects.toThrow();
  });
});
