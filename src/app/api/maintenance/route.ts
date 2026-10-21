import { json, route } from "@/server/http";
import { isMaintenanceEnabled } from "@/server/maintenance";

/** Minimal public state lets an already open page enter and leave the maintenance screen. */
export const GET = route("maintenance.public", async () => json({ enabled: await isMaintenanceEnabled() }));
