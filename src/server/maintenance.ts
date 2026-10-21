import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { getAdmin } from "./admin-auth";
import { AppError, unauthorized } from "./errors";

const MAINTENANCE_KEY = "maintenanceEnabled";
const maintenanceSchema = z.object({ enabled: z.boolean() }).strict();

export type MaintenanceState = { enabled: boolean; updatedAt: string | null };

/** Read afresh: enabling or disabling maintenance must not wait for a process cache. */
export async function getMaintenanceState(): Promise<MaintenanceState> {
  const [row] = await db().select({ value: schema.appSettings.value, updatedAt: schema.appSettings.updatedAt })
    .from(schema.appSettings).where(eq(schema.appSettings.key, MAINTENANCE_KEY)).limit(1);
  return { enabled: row?.value === true, updatedAt: row?.updatedAt.toISOString() ?? null };
}

export async function isMaintenanceEnabled(): Promise<boolean> {
  return (await getMaintenanceState()).enabled;
}

/** Separate from ordinary settings, with database authorization even for internal callers. */
export async function updateMaintenance(adminId: string, input: unknown): Promise<MaintenanceState> {
  const { enabled } = maintenanceSchema.parse(input);
  return db().transaction(async (tx) => {
    const [admin] = await tx.select({ isTemporary: schema.adminUsers.isTemporary })
      .from(schema.adminUsers).where(eq(schema.adminUsers.id, adminId)).for("update").limit(1);
    if (!admin) throw unauthorized();
    if (admin.isTemporary)
      throw new AppError(403, "maintenance_forbidden", "Tylko główny administrator może zarządzać przerwą techniczną.");
    const updatedAt = new Date();
    const [row] = await tx.insert(schema.appSettings)
      .values({ key: MAINTENANCE_KEY, value: enabled, updatedAt })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: enabled, updatedAt } })
      .returning({ value: schema.appSettings.value, updatedAt: schema.appSettings.updatedAt });
    return { enabled: row.value === true, updatedAt: row.updatedAt.toISOString() };
  });
}

/** Only the shared private-file endpoint permits an authenticated administrator. */
export async function assertVisitorAvailable({ allowAdmin = false }: { allowAdmin?: boolean } = {}) {
  if (!(await isMaintenanceEnabled())) return;
  if (allowAdmin && await getAdmin()) return;
  throw new AppError(503, "maintenance", "Trwają prace techniczne. Prosimy spróbować ponownie za chwilę.");
}
