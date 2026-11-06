import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { schema } from "@/db";
import { getLeadDetails } from "@/server/services/admin";
import { ensureLead } from "@/server/services/leads";
import { newSession, setupTestEnv } from "./helpers";

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
afterAll(async () => { await env.client.close(); });

it("shows only the verified email bound to this application, without authentication credentials", async () => {
  const sessionId = await newSession(env.db);
  const otherSessionId = await newSession(env.db);
  const leadId = await ensureLead(env.db, sessionId);
  const otherLeadId = await ensureLead(env.db, otherSessionId);
  const verifiedAt = new Date("2026-11-06T10:00:00Z");
  // Same name/phone must not grant access to another application's email identity.
  await env.db.insert(schema.visitorContacts).values([sessionId, otherSessionId].map(id => ({
    sessionId: id, name: "Anna", phone: "+48600123456",
  })));
  const [account] = await env.db.insert(schema.candidateAccounts).values({
    sessionId, email: "anna@example.com", emailVerifiedAt: verifiedAt,
  }).returning();
  const tokenHash = randomUUID();
  await env.db.insert(schema.candidateDeviceSessions).values({
    accountId: account.id, tokenHash, expiresAt: new Date("2027-01-01T00:00:00Z"),
  });

  const details = await getLeadDetails(leadId);
  expect(details.verifiedEmail).toEqual({ address: "anna@example.com", verifiedAt: verifiedAt.toISOString() });
  expect(JSON.stringify(details)).not.toContain(tokenHash);
  expect(JSON.stringify(details)).not.toContain(account.id);
  expect((await getLeadDetails(otherLeadId)).verifiedEmail).toBeNull();
});

it("does not show an unverified email from a pending sign-in challenge", async () => {
  const sessionId = await newSession(env.db);
  const leadId = await ensureLead(env.db, sessionId);
  const codeHash = randomUUID();
  await env.db.insert(schema.candidateEmailChallenges).values({
    sessionId, email: "not-verified@example.com", codeHash, browserHash: randomUUID(),
    status: "ready", expiresAt: new Date("2027-01-01T00:00:00Z"),
  });

  const details = await getLeadDetails(leadId);
  expect(details.verifiedEmail).toBeNull();
  expect(JSON.stringify(details)).not.toContain("not-verified@example.com");
  expect(JSON.stringify(details)).not.toContain(codeHash);
});
