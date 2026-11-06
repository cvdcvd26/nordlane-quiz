import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PNG, setupTestEnv } from "./helpers";
import { schema } from "@/db";
import { content } from "@/config/content";
import { getOrCreateVisitorSessionId, getVisitorSessionId } from "@/server/visitor-session";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { postVisitorMessage } from "@/server/services/chat";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import {
  getCandidateEmailState, requestCandidateEmail, verifyCandidateEmail, logoutCandidateEmail,
  requireNewCandidateEmail,
} from "@/server/candidate-email-auth";
import { POST as requestRoute } from "@/app/api/candidate/email-request/route";
import { POST as verifyRoute } from "@/app/api/candidate/email-verify/route";
import { POST as logoutRoute } from "@/app/api/candidate/logout/route";
import { GET as sessionRoute } from "@/app/api/session/route";
import { GET as chatRoute } from "@/app/api/chat/route";
import { GET as fileRoute } from "@/app/api/files/[id]/route";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), options: new Map<string, Record<string, unknown>>() }));
const mail = vi.hoisted(() => ({ sent: [] as { email: string; code: string; id: string }[], fail: false }));
const notifications = vi.hoisted(() => ({ welcome: vi.fn(async () => null as string | null), enqueue: vi.fn(async () => {}) }));
const afterResponse = vi.hoisted(() => ({ callbacks: [] as Array<() => Promise<void>> }));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: (callback: () => Promise<void>) => { afterResponse.callbacks.push(callback); },
}));
vi.mock("next/headers", () => ({ cookies: async () => {
  // Each request keeps its own browser cookie store, including parallel devices.
  const values = jar.values;
  const storedOptions = jar.options;
  return {
    get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (options.maxAge === 0) values.delete(name); else values.set(name, value);
      storedOptions.set(name, options);
    },
    delete: (name: string) => values.delete(name),
  };
} }));
vi.mock("@/server/brevo", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/brevo")>();
  return { ...actual, sendCandidateCode: async (email: string, code: string, id: string) => {
    mail.sent.push({ email, code, id });
    if (mail.fail) throw new Error(`provider-body-containing-${code}-${email}`);
  } };
});
vi.mock("@/server/services/candidate-email-notifications", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/services/candidate-email-notifications")>(),
  recordWelcomeEmail: notifications.welcome,
  enqueueCandidateEmail: notifications.enqueue,
}));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  vi.stubEnv("CANDIDATE_EMAIL_SECRET", "candidate-test-secret-at-least-thirty-two-characters");
  vi.stubEnv("BREVO_API_KEY", "test-brevo-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "hr@example.com");
  vi.stubEnv("APP_URL", "https://example.com");
  jar.values.clear(); jar.options.clear(); mail.sent.length = 0; mail.fail = false;
  notifications.welcome.mockReset(); notifications.welcome.mockResolvedValue(null);
  notifications.enqueue.mockReset(); notifications.enqueue.mockResolvedValue(undefined);
  afterResponse.callbacks.length = 0;
  await env.db.delete(schema.candidateEmailChallenges);
  await env.db.delete(schema.candidateAccounts);
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.rateLimits);
  await env.db.delete(schema.appSettings).where(eq(schema.appSettings.key, "maintenanceEnabled"));
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

async function request(email = "anna@example.com", ip = "request-ip") {
  const sessionId = await getOrCreateVisitorSessionId(ip);
  const challenge = await requestCandidateEmail(sessionId, { email }, ip);
  return { sessionId, ...challenge, code: mail.sent.at(-1)!.code };
}
async function register(email = "anna@example.com") {
  const challenge = await request(email);
  await verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code }, "verify-ip");
  return challenge;
}

it("keeps the existing application and replaces anonymous access with a hashed independent credential", async () => {
  const sessionId = await getOrCreateVisitorSessionId("legacy-ip");
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  await saveContact(sessionId, { name: "Anna", phone: "+48600123456", telegram: "" });
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  const oldCookie = jar.values.get("nl_visitor")!;
  const result = await request(" ANNA@EXAMPLE.COM ");
  const [storedChallenge] = await env.db.select().from(schema.candidateEmailChallenges);
  expect(storedChallenge.codeHash).not.toBe(result.code);
  expect(storedChallenge.codeHash).not.toBe(createHash("sha256").update(result.code).digest("hex"));
  expect(storedChallenge.browserHash).not.toBe(jar.values.get("nl_email_challenge"));
  expect(await verifyCandidateEmail({ challengeId: result.challengeId, code: result.code }, "verify-ip")).toEqual({ verified: true, welcomeJobId: null, contactCreated: false });
  expect(await getVisitorSessionId()).toBe(sessionId);
  expect(jar.values.has("nl_visitor")).toBe(false);
  expect(jar.values.has("nl_email_challenge")).toBe(false);
  expect(jar.options.get("nl_candidate")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  const [credential] = await env.db.select().from(schema.candidateDeviceSessions);
  expect(credential.tokenHash).not.toBe(jar.values.get("nl_candidate"));
  expect(await getCandidateEmailState(sessionId)).toEqual({ enabled: true, email: "anna@example.com", verified: true });
  expect((await env.db.select().from(schema.visitorContacts))[0].name).toBe("Anna");
  expect(notifications.welcome).toHaveBeenCalledTimes(1);
  jar.values.clear(); jar.values.set("nl_visitor", oldCookie);
  expect(await getVisitorSessionId()).toBeNull();
});

it("restores the same application on a second device without moving or overwriting either session's data", async () => {
  const first = await register();
  await saveContact(first.sessionId, { name: "Original", phone: "+48600123456", telegram: "" });
  const existingContact = await env.db.select().from(schema.visitorContacts);
  const existingLead = await env.db.select().from(schema.leads);
  const firstDevice = jar.values.get("nl_candidate")!;
  jar.values.clear(); await env.db.delete(schema.rateLimits);
  const second = await request();
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(await verifyCandidateEmail({ challengeId: second.challengeId, code: second.code,
    contact: { name: "Replacement must be ignored", phone: "+48600987654", telegram: "other_person" },
  }, "other-ip")).toMatchObject({ verified: true, contactCreated: false });
  const secondDevice = jar.values.get("nl_candidate")!;
  expect(secondDevice).not.toBe(firstDevice);
  expect(await getVisitorSessionId()).toBe(first.sessionId);
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(1);
  expect(await env.db.select().from(schema.candidateDeviceSessions)).toHaveLength(2);
  expect((await env.db.select().from(schema.visitorContacts))[0]).toMatchObject({ name: "Original", sessionId: first.sessionId });
  expect(await env.db.select().from(schema.visitorContacts)).toEqual(existingContact);
  expect(await env.db.select().from(schema.leads)).toEqual(existingLead);
  expect(notifications.welcome).toHaveBeenCalledTimes(1);
  jar.values.set("nl_candidate", firstDevice);
  expect(await getVisitorSessionId()).toBe(first.sessionId);
});

it("rejects a correct code from another browser without consuming it for its owner", async () => {
  const challenge = await request();
  const browser = jar.values.get("nl_email_challenge")!;
  jar.values.set("nl_email_challenge", "A".repeat(43));
  await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code }, "stranger-ip"))
    .rejects.toMatchObject({ code: "email_code_invalid" });
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
  jar.values.set("nl_email_challenge", browser);
  await verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code }, "owner-ip");
  expect(await getVisitorSessionId()).toBe(challenge.sessionId);
});

it("restores a legacy task, chat and private files after email login without creating another lead", async () => {
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  const sessionId = await getOrCreateVisitorSessionId("legacy-task-ip");
  await saveContact(sessionId, { name: "Anna", phone: "+48600123456", telegram: "" });
  for (const question of content.quiz.questions) await saveAnswer(sessionId, question.key, question.options[0].value);
  const file = await uploadFile({
    sessionId, purpose: "submission", uploadedBy: "visitor",
    file: { name: "private-task.png", type: "image/png", buffer: PNG },
  });
  const task = await submitTask(sessionId, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Moje prywatne uwagi do zadania." });
  const chat = await postVisitorMessage(sessionId, { clientMessageId: randomUUID(), body: "Moja prywatna rozmowa.", fileIds: [] });
  await env.db.update(schema.leads).set({ status: "signal_working" }).where(eq(schema.leads.sessionId, sessionId));
  const [lead] = await env.db.select().from(schema.leads);
  const answers = await env.db.select().from(schema.quizAnswers);

  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  await register(); // Bind the existing anonymous application, including all its data.
  jar.values.clear(); await env.db.delete(schema.rateLimits);
  const returning = await request();
  await verifyCandidateEmail({ challengeId: returning.challengeId, code: returning.code,
    contact: { name: "New draft", phone: "+48600987654", telegram: "" },
  }, "returning-ip"); // Returning on another browser must restore the same application.
  const response = await sessionRoute(new Request("https://example.com/api/session"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    candidateEmail: { verified: true, email: "anna@example.com" },
    contact: { name: "Anna" },
    submission: { id: task.submissionId },
    files: [{ id: file.id }],
  });
  const messages = await chatRoute(new Request("https://example.com/api/chat"));
  expect(messages.status).toBe(200);
  expect((await messages.json()).messages).toContainEqual(expect.objectContaining({ id: chat.message.id, body: "Moja prywatna rozmowa." }));
  const download = await fileRoute(new Request(`https://example.com/api/files/${file.id}`), { params: Promise.resolve({ id: file.id }) });
  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG);
  expect(await env.db.select().from(schema.leads)).toEqual([lead]);
  expect(await env.db.select().from(schema.quizAnswers)).toEqual(answers);

  jar.values.clear(); await env.db.delete(schema.rateLimits);
  await register("other@example.com");
  const otherResponse = await sessionRoute(new Request("https://example.com/api/session"));
  expect(await otherResponse.json()).toMatchObject({ contact: null, submission: null, files: [] });
  const denied = await fileRoute(new Request(`https://example.com/api/files/${file.id}`), { params: Promise.resolve({ id: file.id }) });
  expect(denied.status).toBe(404);
  expect(await env.db.select().from(schema.leads)).toEqual([lead]);
});

it("creates normalized contact and a lead with the verified identity in one successful registration", async () => {
  const challenge = await request();
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(0);
  expect(await env.db.select().from(schema.leads)).toHaveLength(0);
  const response = await verifyRoute(new Request("https://example.com/api/candidate/email-verify", {
    method: "POST", headers: { origin: "https://example.com", host: "example.com", "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.code,
      contact: { name: "  Anna Testowa  ", phone: "+48 600 123 456", telegram: "https://t.me/anna_test" },
    }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ verified: true, contactCreated: true });
  expect(await getVisitorSessionId()).toBe(challenge.sessionId);
  expect(await env.db.select().from(schema.candidateAccounts)).toEqual([expect.objectContaining({
    email: "anna@example.com", sessionId: challenge.sessionId,
  })]);
  expect(await env.db.select().from(schema.visitorContacts)).toEqual([expect.objectContaining({
    sessionId: challenge.sessionId, name: "Anna Testowa", phone: "+48600123456", telegram: "@anna_test",
  })]);
  expect(await env.db.select().from(schema.leads)).toEqual([expect.objectContaining({
    sessionId: challenge.sessionId, status: "new", messageCount: 0,
  })]);
  expect(await env.db.select().from(schema.quizAnswers)).toHaveLength(0);
  expect(await env.db.select().from(schema.messages)).toHaveLength(0);
});

it("does not save a contact or lead for an invalid code, and can use the same draft with the correct code", async () => {
  const challenge = await request();
  const contact = { name: "Anna Testowa", phone: "+48600123456" };
  const wrong = challenge.code === "000000" ? "111111" : "000000";
  await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: wrong, contact }, "invalid-contact-ip"))
    .rejects.toMatchObject({ code: "email_code_invalid" });
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(0);
  expect(await env.db.select().from(schema.leads)).toHaveLength(0);
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
  expect(await env.db.select().from(schema.candidateDeviceSessions)).toHaveLength(0);
  expect((await env.db.select().from(schema.candidateEmailChallenges))[0]).toMatchObject({ status: "ready", attempts: 1 });
  await verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code, contact }, "invalid-contact-ip");
  expect(await env.db.select().from(schema.visitorContacts)).toEqual([expect.objectContaining({ ...contact, telegram: null })]);
  expect(await env.db.select().from(schema.leads)).toHaveLength(1);
});

it("uses the same server contact validation without consuming a correct code for an invalid draft", async () => {
  const challenge = await request();
  await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code,
    contact: { name: " ", phone: "not-a-phone", telegram: "!" },
  }, "bad-draft-ip")).rejects.toMatchObject({ name: "ZodError" });
  expect((await env.db.select().from(schema.candidateEmailChallenges))[0]).toMatchObject({ status: "ready", attempts: 0 });
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(0);
  expect(await env.db.select().from(schema.leads)).toHaveLength(0);
});

it("rolls back identity, contact and code consumption when creating the lead fails", async () => {
  const challenge = await request();
  const input = { challengeId: challenge.challengeId, code: challenge.code,
    contact: { name: "Anna Testowa", phone: "+48600123456" },
  };
  await env.client.exec(`CREATE FUNCTION fail_registration_lead() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'test lead insertion failure'; END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER fail_registration_lead BEFORE INSERT ON leads FOR EACH ROW EXECUTE FUNCTION fail_registration_lead();`);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(verifyCandidateEmail(input, "atomic-ip")).rejects.toMatchObject({ code: "email_unavailable" });
    expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
    expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(0);
    expect(await env.db.select().from(schema.leads)).toHaveLength(0);
    expect(await env.db.select().from(schema.candidateDeviceSessions)).toHaveLength(0);
    expect((await env.db.select().from(schema.candidateEmailChallenges))[0]).toMatchObject({ status: "ready", attempts: 0 });
    expect(jar.values.has("nl_candidate")).toBe(false);
  } finally {
    await env.client.exec("DROP TRIGGER fail_registration_lead ON leads; DROP FUNCTION fail_registration_lead();");
    warning.mockRestore();
  }
  await verifyCandidateEmail(input, "atomic-ip");
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(1);
  expect(await env.db.select().from(schema.leads)).toHaveLength(1);
});

it.each([false, true])("initializes one canonical contact for concurrent browsers using the same email (existing account: %s)", async (existingAccount) => {
  let canonicalSessionId: string | undefined;
  if (existingAccount) {
    canonicalSessionId = (await register()).sessionId;
    jar.values = new Map(); jar.options = new Map();
    await env.db.delete(schema.rateLimits);
  }
  const first = await request();
  const firstBrowser = { values: jar.values, options: jar.options };
  jar.values = new Map(); jar.options = new Map();
  await env.db.delete(schema.rateLimits);
  const second = await request();
  const secondBrowser = { values: jar.values, options: jar.options };
  const firstContact = { name: "First draft", phone: "+48600123456", telegram: null };
  const secondContact = { name: "Second draft", phone: "+48600987654", telegram: null };
  jar.values = firstBrowser.values; jar.options = firstBrowser.options;
  const firstVerification = verifyCandidateEmail({ challengeId: first.challengeId, code: first.code, contact: firstContact }, "first-device-ip");
  jar.values = secondBrowser.values; jar.options = secondBrowser.options;
  const secondVerification = verifyCandidateEmail({ challengeId: second.challengeId, code: second.code, contact: secondContact }, "second-device-ip");
  const verificationResults = await Promise.all([firstVerification, secondVerification]);
  expect(verificationResults).toEqual(expect.arrayContaining([
    { verified: true, welcomeJobId: null, contactCreated: true },
    { verified: true, welcomeJobId: null, contactCreated: false },
  ]));
  const accounts = await env.db.select().from(schema.candidateAccounts);
  expect(accounts).toHaveLength(1);
  const canonical = accounts[0].sessionId;
  if (canonicalSessionId) expect(canonical).toBe(canonicalSessionId);
  const contacts = await env.db.select().from(schema.visitorContacts);
  expect(contacts).toHaveLength(1);
  expect(contacts[0].sessionId).toBe(canonical);
  expect([firstContact, secondContact]).toContainEqual({ name: contacts[0].name, phone: contacts[0].phone, telegram: contacts[0].telegram });
  expect(await env.db.select().from(schema.leads)).toEqual([expect.objectContaining({ sessionId: canonical, status: "new" })]);
  const devices = await env.db.select().from(schema.candidateDeviceSessions);
  expect(devices).toHaveLength(existingAccount ? 3 : 2);
  expect(devices.every(device => device.accountId === accounts[0].id)).toBe(true);
  for (const browser of [firstBrowser, secondBrowser]) {
    jar.values = browser.values; jar.options = browser.options;
    expect(await getVisitorSessionId()).toBe(canonical);
  }
  expect(notifications.welcome).toHaveBeenCalledTimes(1);
});

it("commits failed attempts and blocks even the correct code after five failures", async () => {
  const challenge = await request();
  const wrong = challenge.code === "000000" ? "111111" : "000000";
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: wrong }, "guess-ip"))
      .rejects.toMatchObject({ code: "email_code_invalid" });
  }
  const [stored] = await env.db.select().from(schema.candidateEmailChallenges);
  expect(stored).toMatchObject({ attempts: 5, status: "failed" });
  await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code }, "guess-ip"))
    .rejects.toMatchObject({ code: "email_code_invalid" });
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
});

it("expires a code after ten minutes and never accepts it again", async () => {
  const challenge = await request();
  await env.db.update(schema.candidateEmailChallenges).set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(schema.candidateEmailChallenges.id, challenge.challengeId));
  await expect(verifyCandidateEmail({ challengeId: challenge.challengeId, code: challenge.code }, "expiry-ip"))
    .rejects.toMatchObject({ code: "email_code_expired" });
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
});

it("consumes a code exactly once under concurrent verification", async () => {
  const challenge = await request();
  const input = { challengeId: challenge.challengeId, code: challenge.code,
    contact: { name: "Anna Testowa", phone: "+48600123456" },
  };
  const results = await Promise.allSettled([verifyCandidateEmail(input, "race-ip"), verifyCandidateEmail(input, "race-ip")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(1);
  expect(await env.db.select().from(schema.candidateDeviceSessions)).toHaveLength(1);
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(1);
  expect(await env.db.select().from(schema.leads)).toHaveLength(1);
  expect(notifications.welcome).toHaveBeenCalledTimes(1);
});

it("does not allow one bound application to be re-registered under another address", async () => {
  const first = await register();
  await env.db.delete(schema.rateLimits);
  const second = await request("different@example.com");
  await expect(verifyCandidateEmail({ challengeId: second.challengeId, code: second.code }, "other-email-ip"))
    .rejects.toMatchObject({ code: "email_address_conflict" });
  expect((await env.db.select().from(schema.candidateAccounts))[0]).toMatchObject({ email: "anna@example.com", sessionId: first.sessionId });
});

it("does not match another application by phone or name", async () => {
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  const old = await getOrCreateVisitorSessionId("old-person");
  await saveContact(old, { name: "Anna", phone: "+48600123456", telegram: "" });
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  jar.values.clear();
  const next = await register();
  await saveContact(next.sessionId, { name: "Anna", phone: "+48600123456", telegram: "" });
  expect(next.sessionId).not.toBe(old);
  expect(await getVisitorSessionId()).toBe(next.sessionId);
  expect(await env.db.select().from(schema.visitorContacts)).toHaveLength(2);
});

it("keeps the legacy flow when disabled and gates only new contacts when enabled", async () => {
  const old = await getOrCreateVisitorSessionId("grandfathered-ip");
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  await saveContact(old, { name: "Legacy", phone: "+48600123456", telegram: "" });
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "true");
  await expect(requireNewCandidateEmail(old)).resolves.toBeUndefined();
  jar.values.clear(); const fresh = await getOrCreateVisitorSessionId("fresh-ip");
  await expect(requireNewCandidateEmail(fresh)).rejects.toMatchObject({ code: "email_verification_required" });
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  await expect(requireNewCandidateEmail(fresh)).resolves.toBeUndefined();
  await expect(requestCandidateEmail(fresh, { email: "new@example.com" }, "disabled-ip")).rejects.toMatchObject({ code: "email_disabled" });
  expect(mail.sent).toHaveLength(0);
});

it("does not enable sign-in with a missing secret or sender configuration", async () => {
  const id = await getOrCreateVisitorSessionId("misconfigured-ip");
  for (const variable of ["CANDIDATE_EMAIL_SECRET", "BREVO_API_KEY", "BREVO_SENDER_EMAIL", "APP_URL"]) {
    const previous = process.env[variable]!;
    vi.stubEnv(variable, "");
    expect((await getCandidateEmailState(id)).enabled).toBe(false);
    await expect(requestCandidateEmail(id, { email: "anna@example.com" }, "missing-config-ip")).rejects.toMatchObject({ code: "email_disabled" });
    vi.stubEnv(variable, previous);
  }
  expect(mail.sent).toHaveLength(0);
});

it("does not invalidate signed-in credentials because the original guest session is old or sending is disabled", async () => {
  const registered = await register();
  await env.db.update(schema.visitorSessions).set({ createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) })
    .where(eq(schema.visitorSessions.id, registered.sessionId));
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  expect(await getVisitorSessionId()).toBe(registered.sessionId);
});

it("expires device credentials and revokes only the logged-out device", async () => {
  const first = await register();
  const firstDevice = jar.values.get("nl_candidate")!;
  jar.values.clear(); await env.db.delete(schema.rateLimits);
  const second = await request();
  await verifyCandidateEmail({ challengeId: second.challengeId, code: second.code }, "device-two");
  const secondDevice = jar.values.get("nl_candidate")!;
  jar.values.set("nl_visitor", "old-guest-cookie");
  await logoutCandidateEmail();
  expect(jar.values.size).toBe(0);
  jar.values.set("nl_candidate", secondDevice);
  expect(await getVisitorSessionId()).toBeNull();
  jar.values.set("nl_candidate", firstDevice);
  expect(await getVisitorSessionId()).toBe(first.sessionId);
  await env.db.update(schema.candidateDeviceSessions).set({ expiresAt: new Date(Date.now() - 1) });
  expect(await getVisitorSessionId()).toBeNull();
});

it("rate-limits resend by email across browsers and never sends duplicate codes on a rapid retry", async () => {
  await request();
  jar.values.clear();
  const differentDevice = await getOrCreateVisitorSessionId("different-device-ip");
  await expect(requestCandidateEmail(differentDevice, { email: "anna@example.com" }, "different-device-ip"))
    .rejects.toMatchObject({ status: 429 });
  expect(mail.sent).toHaveLength(1);
});

it("marks provider failures unusable and never exposes a provider response or code", async () => {
  mail.fail = true;
  const id = await getOrCreateVisitorSessionId("failed-provider-ip");
  await expect(requestCandidateEmail(id, { email: "anna@example.com" }, "failed-provider-ip"))
    .rejects.toMatchObject({ code: "email_send_failed", message: "Nie udało się wysłać kodu. Spróbuj ponownie za chwilę." });
  const [challenge] = await env.db.select().from(schema.candidateEmailChallenges);
  expect(challenge.status).toBe("failed");
  await expect(verifyCandidateEmail({ challengeId: challenge.id, code: mail.sent[0].code }, "failed-provider-ip"))
    .rejects.toMatchObject({ code: "email_code_invalid" });
});

it("returns login cookies before welcome enqueue, hides job IDs and tolerates dispatch failure", async () => {
  notifications.welcome.mockResolvedValue("test-welcome-job");
  notifications.enqueue.mockRejectedValue(new Error("queue offline"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const challenge = await request();
    const response = await verifyRoute(new Request("https://example.com/api/candidate/email-verify", {
      method: "POST", headers: { origin: "https://example.com", host: "example.com", "content-type": "application/json" },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.code }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ verified: true, contactCreated: false });
    expect(await getVisitorSessionId()).toBe(challenge.sessionId);
    expect(notifications.enqueue).not.toHaveBeenCalled();
    expect(afterResponse.callbacks).toHaveLength(1);
    await afterResponse.callbacks[0]();
    expect(notifications.enqueue).toHaveBeenCalledWith("test-welcome-job");
    expect(warning).toHaveBeenCalledWith("candidate.email.welcome_enqueue_failed");
    expect(await getVisitorSessionId()).toBe(challenge.sessionId);
  } finally { warning.mockRestore(); }
});

it("rejects cross-site auth mutations before sending or changing data", async () => {
  const cases = [
    [requestRoute, "/email-request", "POST", { email: "anna@example.com" }],
    [verifyRoute, "/email-verify", "POST", { challengeId: randomUUID(), code: "123456" }],
    [logoutRoute, "/logout", "POST", {}],
  ] as const;
  for (const [handler, path, method, body] of cases) {
    const response = await handler(new Request(`https://example.com/api/candidate${path}`, {
      method, headers: { origin: "https://attacker.example", host: "example.com", "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify(body),
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(mail.sent).toHaveLength(0);
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
});

it("closes candidate email routes during maintenance before creating a challenge or session", async () => {
  await env.db.insert(schema.appSettings).values({ key: "maintenanceEnabled", value: true });
  const response = await requestRoute(new Request("https://example.com/api/candidate/email-request", {
    method: "POST", headers: { origin: "https://example.com", host: "example.com", "content-type": "application/json" },
    body: JSON.stringify({ email: "anna@example.com" }),
  }));
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "maintenance" });
  expect(mail.sent).toHaveLength(0);
  expect(await env.db.select().from(schema.candidateEmailChallenges)).toHaveLength(0);
  expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(0);
});
