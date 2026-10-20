import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { badRequest, unauthorized } from "./errors";
import { rateLimit, resetRateLimit } from "./rate-limit";
import { log } from "./log";
import { content } from "@/config/content";

const COOKIE = "nl_admin";
const SESSION_HOURS = 12;
const BCRYPT_ROUNDS = 12;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("ADMIN_SESSION_SECRET must be set (at least 32 characters).");
  return new TextEncoder().encode(s);
}

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

export const passwordSchema = z
  .string()
  .min(10, content.admin.settings.password.tooShort)
  .max(72, content.admin.settings.password.tooLong)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, content.admin.settings.password.tooLong);

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(content.admin.login.invalidEmail), password: z.string().min(1).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72) });

/**
 * First-run bootstrap: if there are no admins yet and ADMIN_EMAIL / ADMIN_PASSWORD are set,
 * the first successful login with exactly those credentials creates the admin (password is hashed).
 * After that the env password is ignored.
 */
async function bootstrapAdmin(email: string, password: string) {
  const envEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envEmail || !envPassword || email !== envEmail || password !== envPassword) return null;
  const [{ n }] = await db().select({ n: count() }).from(schema.adminUsers);
  if (n > 0) return null;
  const [admin] = await db()
    .insert(schema.adminUsers)
    .values({ email, passwordHash: await hashPassword(password) })
    .onConflictDoNothing()
    .returning();
  if (admin) log.warn("admin", "bootstrap admin created from env — remove ADMIN_PASSWORD from env");
  return admin ?? null;
}

// Constant-ish work even when the user doesn't exist (no user enumeration via timing).
const DUMMY_HASH = "$2b$12$vpoVMm7B/JShB.8xDh/zJOV4avHshTrHyYrRAnkgI9deaYxRtZ7tG";

export async function login(input: unknown, ip: string) {
  const { email, password } = loginSchema.parse(input);
  await rateLimit(`login:ip:${ip}`, 10, 15 * 60);
  await rateLimit(`login:email:${email}`, 5, 15 * 60);

  let [admin] = await db().select().from(schema.adminUsers).where(eq(schema.adminUsers.email, email)).limit(1);
  if (!admin) admin = (await bootstrapAdmin(email, password)) ?? undefined!;

  const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || !ok) {
    log.warn("admin", "failed login", { ip });
    throw unauthorized(content.admin.login.invalid);
  }
  await resetRateLimit(`login:email:${email}`);
  await setSessionCookie(admin.id, admin.tokenVersion);
  return { email: admin.email };
}

async function setSessionCookie(adminId: string, version: number) {
  const token = await new SignJWT({ v: version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

/** Server-side check used by every admin route and by file access. */
export async function getAdmin() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const [admin] = await db().select().from(schema.adminUsers).where(eq(schema.adminUsers.id, payload.sub)).limit(1);
    if (!admin || admin.tokenVersion !== payload.v) return null;
    return { id: admin.id, email: admin.email };
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) throw unauthorized();
  return admin;
}

const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

export async function changePassword(adminId: string, input: unknown, ip: string) {
  const { currentPassword, newPassword } = changeSchema.parse(input);
  await rateLimit(`password:${adminId}:${ip}`, 5, 15 * 60);
  const updated = await db().transaction(async (tx) => {
    const [admin] = await tx.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, adminId)).for("update");
    if (!admin || !(await bcrypt.compare(currentPassword, admin.passwordHash)))
      throw badRequest(content.admin.settings.password.wrongCurrent, "wrong_password");
    const [row] = await tx.update(schema.adminUsers).set({
      passwordHash: await hashPassword(newPassword), tokenVersion: sql`${schema.adminUsers.tokenVersion} + 1`, updatedAt: new Date(),
    }).where(eq(schema.adminUsers.id, adminId)).returning();
    return row;
  });
  await setSessionCookie(updated.id, updated.tokenVersion);
}
