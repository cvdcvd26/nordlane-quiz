import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { translationStatus } from "@/server/services/translations";
import { AppError } from "@/server/errors";

export const GET = route("admin.translation.status", async () => {
  await requireAdmin();
  try {
    return json(await translationStatus());
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Provider/database exceptions must never expose message text or credentials.
    console.warn("translation.status_failed");
    throw new AppError(503, "translation_unavailable", "Translation is temporarily unavailable.");
  }
});
