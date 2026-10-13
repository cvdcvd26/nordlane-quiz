import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";

export const GET = route("admin.me", async () => json({ admin: await requireAdmin() }));
