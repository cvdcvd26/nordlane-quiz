import { randomBytes } from "node:crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword } from "@/server/admin-auth";
import { AppError, unauthorized } from "@/server/errors";
import { rateLimit } from "@/server/rate-limit";

const MAX_TEST_ACCOUNTS = 10;
const accountFields = {
  id: schema.adminUsers.id,
  email: schema.adminUsers.email,
  createdAt: schema.adminUsers.createdAt,
};
const accountNotFound = () => new AppError(404, "test_access_not_found", "Test account not found.");

async function assertPermanentAdmin(adminId: string) {
  const [admin] = await db().select({ isTemporary: schema.adminUsers.isTemporary })
    .from(schema.adminUsers).where(eq(schema.adminUsers.id, adminId)).limit(1);
  if (!admin) throw unauthorized();
  if (admin.isTemporary) throw new AppError(403, "test_access_forbidden", "Only the main administrator can manage test access.");
}

export async function listTestAccounts(adminId: string) {
  await assertPermanentAdmin(adminId);
  return db().select(accountFields).from(schema.adminUsers)
    .where(eq(schema.adminUsers.isTemporary, true))
    .orderBy(desc(schema.adminUsers.createdAt), desc(schema.adminUsers.id));
}

/** The generated password is returned once, and only its bcrypt hash is persisted. */
export async function createTestAccount(adminId: string) {
  await assertPermanentAdmin(adminId);
  await rateLimit(`test-access:create:${adminId}`, 5, 60 * 60);
  const email = `test-${randomBytes(8).toString("hex")}@alleybiz.local`;
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(password);

  const account = await db().transaction(async (tx) => {
    // Serialize creation across every main admin, so concurrent requests cannot exceed the cap.
    await tx.execute(sql`lock table admin_users in share row exclusive mode`);
    const [{ n }] = await tx.select({ n: count() }).from(schema.adminUsers)
      .where(eq(schema.adminUsers.isTemporary, true));
    if (n >= MAX_TEST_ACCOUNTS)
      throw new AppError(409, "test_access_limit", "Delete an existing test account before creating another one.");
    const [created] = await tx.insert(schema.adminUsers)
      .values({ email, passwordHash, isTemporary: true }).returning(accountFields);
    return created;
  });
  return { account, password };
}

export async function deleteTestAccount(adminId: string, rawId: string) {
  await assertPermanentAdmin(adminId);
  const parsed = z.string().uuid().safeParse(rawId);
  if (!parsed.success) throw accountNotFound();
  // Never accept a permanent account ID. Existing JWTs stop working on their next DB lookup.
  const removed = await db().delete(schema.adminUsers)
    .where(and(eq(schema.adminUsers.id, parsed.data), eq(schema.adminUsers.isTemporary, true)))
    .returning({ id: schema.adminUsers.id });
  if (!removed.length) throw accountNotFound();
  return { ok: true };
}
