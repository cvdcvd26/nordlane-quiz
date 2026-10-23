import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { AppError, badRequest, conflict, unauthorized } from "./errors";
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
    return { id: admin.id, email: admin.email, isTemporary: admin.isTemporary };
  } catch {
    return null;
  }
}

export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) throw unauthorized();
  return admin;
}

/** Temporary test accounts may use the admin panel but cannot manage access. */
export async function requirePermanentAdmin() {
  const admin = await requireAdmin();
  if (admin.isTemporary) throw new AppError(403, "test_access_forbidden", "Only the main administrator can manage test access.");
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

const replaceAccessSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(content.admin.login.invalidEmail),
  currentPassword: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72),
  newPassword: passwordSchema,
}).strict();

function isUniqueViolation(error: unknown): boolean {
  for (let depth = 0; error && typeof error === "object" && depth < 5; depth++) {
    if ("code" in error && error.code === "23505") return true;
    error = "cause" in error ? error.cause : null;
  }
  return false;
}

/** Replace this owner's credentials atomically; no new account or permissions are created. */
export async function replaceMainAdminAccess(adminId: string, input: unknown, ip: string) {
  await rateLimit(`main-access:${adminId}`, 5, 15 * 60);
  await rateLimit(`main-access:ip:${ip}`, 10, 15 * 60);
  const { email, currentPassword, newPassword } = replaceAccessSchema.parse(input);
  let updated: typeof schema.adminUsers.$inferSelect;
  try {
    updated = await db().transaction(async tx => {
      const [admin] = await tx.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, adminId)).for("update");
      if (!admin) throw unauthorized();
      if (admin.isTemporary !== false)
        throw new AppError(403, "main_access_forbidden", "Only the main administrator can replace this access.");
      if (!(await bcrypt.compare(currentPassword, admin.passwordHash)))
        throw badRequest(content.admin.settings.password.wrongCurrent, "wrong_password");
      if (await bcrypt.compare(newPassword, admin.passwordHash))
        throw badRequest("Choose a password different from the current one.", "password_unchanged");
      const [row] = await tx.update(schema.adminUsers).set({
        email, passwordHash: await hashPassword(newPassword),
        tokenVersion: sql`${schema.adminUsers.tokenVersion} + 1`, updatedAt: new Date(),
      }).where(eq(schema.adminUsers.id, adminId)).returning();
      return row;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) throw conflict("This email is already used by another administrator.", "admin_email_in_use");
    // Database errors can contain query parameters, including an email and password hash.
    console.warn("admin.credentials_change_failed");
    throw new AppError(500, "main_access_failed", "The administrator access could not be changed.");
  }
  await setSessionCookie(updated.id, updated.tokenVersion);
  return { email: updated.email };
}
