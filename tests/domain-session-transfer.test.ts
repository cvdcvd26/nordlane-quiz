import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { setupTestEnv, PNG } from "./helpers";
import { MIGRATION_CHECKED_COOKIE, MIGRATION_NONCE_COOKIE, siteDomains } from "@/config/site-domains";
import { startDomainSessionTransfer, authorizeDomainSessionTransfer, completeDomainSessionTransfer } from "@/server/domain-session-transfer";
import { credentialHash } from "@/server/visitor-credentials";
import { getOrCreateVisitorSessionId, getVisitorSessionId } from "@/server/visitor-session";
import { logoutCandidateEmail } from "@/server/candidate-email-auth";
import { saveContact } from "@/server/services/contact";
import { saveAnswer } from "@/server/services/quiz";
import { postVisitorMessage } from "@/server/services/chat";
import { uploadFile } from "@/server/services/uploads";
import { submitTask } from "@/server/services/submission";
import { content } from "@/config/content";
import { GET as sessionRoute } from "@/app/api/session/route";
import { GET as fileRoute } from "@/app/api/files/[id]/route";
import { GET as chatRoute } from "@/app/api/chat/route";
import { POST as completeRoute } from "@/app/api/session-transfer/complete/route";
import { GET as finishRoute } from "@/app/session-transfer/complete/route";
import { GET as skipRoute } from "@/app/session-transfer/skip/route";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), options: new Map<string, Record<string, unknown>>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.values.has(name) ? { value: jar.values.get(name)! } : undefined,
  set: (name: string, value: string, options: Record<string, unknown>) => {
    if (options.maxAge === 0) jar.values.delete(name); else jar.values.set(name, value);
    jar.options.set(name, options);
  },
}) }));
let env: Awaited<ReturnType<typeof setupTestEnv>>;
const newUrl = `${siteDomains.canonical}/session-transfer/start`;
const oldUrl = `${siteDomains.legacy}/session-transfer/authorize`;
const completeUrl = `${siteDomains.canonical}/api/session-transfer/complete`;
function browser(values: Map<string, string>) { jar.values = new Map(values); }
async function guest(contact = true) {
  jar.values.clear();
  const id = await getOrCreateVisitorSessionId(randomUUID());
  if (contact) await saveContact(id, { name: "Migration test", phone: "+48600123456" });
  return { id, cookie: new Map(jar.values) };
}
async function grant(source: Map<string, string>, destination = "/step-4-confirmation?utm_source=facebook", target = new Map<string, string>()) {
  browser(target);
  const redirect = new URL(await startDomainSessionTransfer(newUrl, destination, "start-ip"));
  const state = redirect.searchParams.get("state")!;
  const targetCookies = new Map(jar.values);
  browser(source);
  const finish = new URL(await authorizeDomainSessionTransfer(oldUrl, state, "old-ip"));
  const fragment = new URLSearchParams(finish.hash.slice(1));
  expect(finish.search).toBe("");
  expect(finish.origin).toBe(siteDomains.canonical);
  browser(targetCookies);
  return { state, code: fragment.get("code")!, targetCookies, finish: finish.href };
}
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  vi.stubEnv("LEGACY_SITE_RETIRED", "false");
  vi.stubEnv("APP_URL", siteDomains.canonical);
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "true");
  vi.stubEnv("CANDIDATE_EMAIL_ENABLED", "false");
  jar.values.clear(); jar.options.clear();
  await env.db.delete(schema.domainSessionTransfers);
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.rateLimits);
  await env.db.delete(schema.appSettings);
});
afterAll(async () => { vi.unstubAllEnvs(); await env.client.close(); });

it("preserves the complete guest application with independent hashed credentials and no duplicate lead", async () => {
  const source = await guest();
  for (const q of content.quiz.questions) await saveAnswer(source.id, q.key, q.options[0].value);
  const file = await uploadFile({ sessionId: source.id, purpose: "submission", uploadedBy: "visitor", file: { name: "test.png", type: "image/png", buffer: PNG } });
  const submission = await submitTask(source.id, { idempotencyKey: randomUUID(), fileIds: [file.id], review: "Moje wykonane zadanie" });
  await postVisitorMessage(source.id, { clientMessageId: randomUUID(), body: "Test conversation", fileIds: [] });
  const leads = await env.db.select().from(schema.leads);
  const input = await grant(source.cookie);
  const result = await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  expect(result.destination).toBe("/step-4-confirmation?utm_source=facebook");
  expect(await getVisitorSessionId()).toBe(source.id);
  expect(jar.values.get("nl_visitor")).not.toBe(source.cookie.get("nl_visitor"));
  expect(jar.values.get(MIGRATION_CHECKED_COOKIE)).toBe("1");
  expect(jar.values.has(MIGRATION_NONCE_COOKIE)).toBe(false);
  expect(jar.options.get("nl_visitor")).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
  expect(jar.options.get("nl_visitor")).not.toHaveProperty("domain");
  const stored = (await env.db.select().from(schema.visitorDeviceSessions))[0];
  expect(stored.tokenHash).toBe(credentialHash(jar.values.get("nl_visitor")!));
  const payload = await (await sessionRoute(new Request(`${siteDomains.canonical}/api/session`))).json();
  expect(payload).toMatchObject({ contact: { name: "Migration test" }, submission: { id: submission.submissionId }, files: [{ id: file.id }], restoredSession: true });
  expect(await env.db.select().from(schema.leads)).toEqual(leads);
  expect(await env.db.select().from(schema.messages)).toHaveLength(2);
  const conversation = await (await chatRoute(new Request(`${siteDomains.canonical}/api/chat`))).json();
  expect(conversation.messages).toContainEqual(expect.objectContaining({ body: "Test conversation" }));
  const download = await fileRoute(new Request(`${siteDomains.canonical}/api/files/${file.id}`), { params: Promise.resolve({ id: file.id }) });
  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG);
  browser(source.cookie);
  expect(await getVisitorSessionId()).toBe(source.id);
});

it("requires the new-origin browser nonce and does not consume a grant on another browser", async () => {
  const source = await guest();
  const input = await grant(source.cookie);
  jar.values.set(MIGRATION_NONCE_COOKIE, randomBytes(32).toString("base64url"));
  await expect(completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "attacker"))
    .rejects.toMatchObject({ code: "transfer_invalid" });
  expect((await env.db.select().from(schema.domainSessionTransfers))[0].consumedAt).toBeNull();
  browser(input.targetCookies);
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "owner");
  expect(await getVisitorSessionId()).toBe(source.id);
});

it("consumes grants exactly once even with the original browser nonce replayed", async () => {
  const source = await guest();
  const input = await grant(source.cookie);
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  browser(input.targetCookies);
  await expect(completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip"))
    .rejects.toMatchObject({ code: "transfer_invalid" });
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(1);
});

it("cannot redeem one grant twice through concurrent requests", async () => {
  const input = await grant((await guest()).cookie);
  const payload = { state: input.state, code: input.code };
  const results = await Promise.allSettled([
    completeDomainSessionTransfer(completeUrl, payload, "concurrent-ip"),
    completeDomainSessionTransfer(completeUrl, payload, "concurrent-ip"),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(1);
});

it("rejects a mismatched code, expired grant and reauthorization", async () => {
  const input = await grant((await guest()).cookie);
  await expect(authorizeDomainSessionTransfer(oldUrl, input.state, "again"))
    .rejects.toMatchObject({ code: "transfer_invalid" });
  await expect(completeDomainSessionTransfer(completeUrl, { state: input.state, code: randomBytes(32).toString("base64url") }, "new-ip"))
    .rejects.toMatchObject({ code: "transfer_invalid" });
  await expect(completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip", new Date(Date.now() + 91_000)))
    .rejects.toMatchObject({ code: "transfer_invalid" });
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(0);
});

it("does not restore a guest whose old credential was revoked after authorizing", async () => {
  const source = await guest();
  const input = await grant(source.cookie);
  await env.db.update(schema.visitorSessions).set({ tokenHash: credentialHash(randomUUID()) }).where(eq(schema.visitorSessions.id, source.id));
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  expect(await getVisitorSessionId()).toBeNull();
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(0);
});

it("revokes migrated guest access when email binding rotates the parent credential", async () => {
  const source = await guest();
  const input = await grant(source.cookie);
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  expect(await getVisitorSessionId()).toBe(source.id);
  await env.db.update(schema.visitorSessions).set({ tokenHash: credentialHash(randomUUID()) }).where(eq(schema.visitorSessions.id, source.id));
  expect(await getVisitorSessionId()).toBeNull();
  browser(source.cookie);
  expect(await getVisitorSessionId()).toBeNull();
});

it("does not extend the original anonymous session lifetime and can revoke only the new device", async () => {
  const source = await guest();
  const nearExpiry = new Date(Date.now() - 180 * 24 * 3600_000 + 120_000);
  await env.db.update(schema.visitorSessions).set({ createdAt: nearExpiry }).where(eq(schema.visitorSessions.id, source.id));
  const input = await grant(source.cookie);
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  const newCookie = new Map(jar.values);
  expect(jar.options.get("nl_visitor")!.maxAge).toBeLessThanOrEqual(120);
  await logoutCandidateEmail();
  browser(newCookie);
  expect(await getVisitorSessionId()).toBeNull();
  browser(source.cookie);
  expect(await getVisitorSessionId()).toBe(source.id);
});

it("transfers verified candidates with a separate bounded device session and isolated logout", async () => {
  const source = await guest();
  const token = randomBytes(32).toString("base64url");
  const [account] = await env.db.insert(schema.candidateAccounts).values({ sessionId: source.id, email: "test@example.com" }).returning();
  const expiry = new Date(Date.now() + 60_000);
  await env.db.insert(schema.candidateDeviceSessions).values({ accountId: account.id, tokenHash: credentialHash(token), expiresAt: expiry });
  const input = await grant(new Map([["nl_candidate", token], ["nl_admin", "never-transfer-admin"]]));
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  const migrated = jar.values.get("nl_candidate")!;
  expect(migrated).not.toBe(token);
  expect(jar.values.has("nl_admin")).toBe(false);
  expect(await getVisitorSessionId()).toBe(source.id);
  expect(jar.options.get("nl_candidate")!.maxAge).toBeLessThanOrEqual(60);
  const devices = await env.db.select().from(schema.candidateDeviceSessions);
  expect(devices).toHaveLength(2);
  expect(devices.every(device => device.expiresAt.getTime() === expiry.getTime())).toBe(true);
  await logoutCandidateEmail();
  jar.values.set("nl_candidate", migrated);
  expect(await getVisitorSessionId()).toBeNull();
  jar.values.set("nl_candidate", token);
  expect(await getVisitorSessionId()).toBe(source.id);
});

it("does not exchange revoked candidate credentials", async () => {
  const source = await guest();
  const token = randomBytes(32).toString("base64url");
  const [account] = await env.db.insert(schema.candidateAccounts).values({ sessionId: source.id, email: "test@example.com" }).returning();
  await env.db.insert(schema.candidateDeviceSessions).values({ accountId: account.id, tokenHash: credentialHash(token), expiresAt: new Date(Date.now() + 60_000) });
  const input = await grant(new Map([["nl_candidate", token]]));
  await env.db.delete(schema.candidateDeviceSessions);
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  expect(await getVisitorSessionId()).toBeNull();
  expect(await env.db.select().from(schema.candidateDeviceSessions)).toHaveLength(0);
});

it("never creates a guest or lead just because an anonymous new visitor traverses the bridge", async () => {
  const input = await grant(new Map([["nl_admin", "ignored"]]));
  await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip");
  expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(0);
  expect(await env.db.select().from(schema.leads)).toHaveLength(0);
  expect(await env.db.select().from(schema.candidateAccounts)).toHaveLength(0);
  expect([...jar.values.keys()]).toEqual([MIGRATION_CHECKED_COOKIE]);
});

it("preserves a populated target both before the round trip and if populated by another tab", async () => {
  const source = await guest();
  const target = await guest();
  expect(await startDomainSessionTransfer(newUrl, "/step-3-task", "new-ip")).toBe(`${siteDomains.canonical}/step-3-task`);
  expect(await env.db.select().from(schema.domainSessionTransfers)).toHaveLength(0);
  const empty = await guest(false);
  const input = await grant(source.cookie, "/step-4-confirmation", empty.cookie);
  await saveContact(empty.id, { name: "Different target application", phone: "+48600987654" });
  expect(await completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "new-ip")).toEqual({ destination: "/?account=1" });
  expect(await getVisitorSessionId()).toBe(empty.id);
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(0);
  expect(target.id).not.toBe(source.id);
});

it("requires activation on the exact canonical origin and rejects preview/attacker hosts", async () => {
  for (const url of ["https://evil.test/", "https://itsolution.fun.evil.test/", "http://itsolution.fun/", "https://land.itsolution.fun/", "https://preview.vercel.app/"]) {
    await expect(startDomainSessionTransfer(url, "/", "ip")).rejects.toMatchObject({ status: 404 });
  }
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "false");
  await expect(startDomainSessionTransfer(newUrl, "/", "ip")).rejects.toMatchObject({ status: 404 });
  vi.stubEnv("SITE_DOMAIN_MIGRATION_ENABLED", "true"); vi.stubEnv("APP_URL", siteDomains.legacy);
  await expect(startDomainSessionTransfer(newUrl, "/", "ip")).rejects.toMatchObject({ status: 404 });
  expect(await env.db.select().from(schema.domainSessionTransfers)).toHaveLength(0);
});

it("refuses all session recovery after retirement and preserves existing leads and conversation data", async () => {
  const source = await guest();
  for (const q of content.quiz.questions) await saveAnswer(source.id, q.key, q.options[0].value);
  await postVisitorMessage(source.id, { clientMessageId: randomUUID(), body: "Preserved conversation", fileIds: [] });
  const input = await grant(source.cookie);
  const leads = await env.db.select().from(schema.leads);
  const messages = await env.db.select().from(schema.messages);
  const transfers = await env.db.select().from(schema.domainSessionTransfers);
  const sessions = await env.db.select().from(schema.visitorSessions);
  vi.stubEnv("LEGACY_SITE_RETIRED", "true");
  for (const action of [
    () => startDomainSessionTransfer(newUrl, "/", "ip"),
    () => authorizeDomainSessionTransfer(oldUrl, input.state, "ip"),
    () => completeDomainSessionTransfer(completeUrl, { state: input.state, code: input.code }, "ip"),
  ]) await expect(action()).rejects.toMatchObject({ status: 404 });
  expect((await finishRoute(new Request(`${siteDomains.canonical}/session-transfer/complete`))).status).toBe(404);
  expect((await skipRoute(new Request(`${siteDomains.canonical}/session-transfer/skip`))).status).toBe(404);
  expect(await env.db.select().from(schema.leads)).toEqual(leads);
  expect(await env.db.select().from(schema.messages)).toEqual(messages);
  expect(await env.db.select().from(schema.visitorSessions)).toEqual(sessions);
  expect(await env.db.select().from(schema.domainSessionTransfers)).toEqual(transfers);
  expect(await env.db.select().from(schema.visitorDeviceSessions)).toHaveLength(0);
});

it("rejects missing/cross-site origins and grants only a matching browser's same-origin POST", async () => {
  const input = await grant((await guest()).cookie);
  const body = JSON.stringify({ state: input.state, code: input.code });
  for (const origin of [null, "https://evil.test", siteDomains.legacy]) {
    const response = await completeRoute(new Request(completeUrl, { method: "POST", headers: { host: "itsolution.fun", ...(origin ? { origin } : {}) }, body }));
    expect(response.status).toBe(403);
  }
  const result = await completeRoute(new Request(completeUrl, { method: "POST", headers: { host: "itsolution.fun", origin: siteDomains.canonical, "sec-fetch-site": "same-origin" }, body }));
  expect(result.status).toBe(200);
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(result.headers.get("cache-control")).toBe("private, no-store");
});

it("uses isolated CSP-protected HTML, clears the fragment before POST and never loads trackers", async () => {
  const response = await finishRoute(new Request(`${siteDomains.canonical}/session-transfer/complete`));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const html = await response.text();
  expect(html.indexOf("history.replaceState")).toBeLessThan(html.indexOf("fetch("));
  expect(html).not.toContain("fbevents");
  expect(html).not.toContain("<script src=");
  expect(html).not.toContain("_next");
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1];
  expect(() => new Function(script)).not.toThrow();
  const responseSkip = await skipRoute(new Request(`${siteDomains.canonical}/session-transfer/skip`));
  expect(responseSkip.headers.get("location")).toBe(`${siteDomains.canonical}/?account=1`);
  expect([...jar.values.keys()]).toEqual([MIGRATION_CHECKED_COOKIE]);
  expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(0);
});
