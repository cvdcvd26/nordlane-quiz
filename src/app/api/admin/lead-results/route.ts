import { requirePermanentAdmin } from "@/server/admin-auth";
import { json, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getLeadResults } from "@/server/services/lead-results";

const report = route("admin.lead-results", async (req: Request) => {
  const admin = await requirePermanentAdmin();
  await rateLimit(`admin-lead-results:${admin.id}`, 60, 60);
  return json(await getLeadResults(Object.fromEntries(new URL(req.url).searchParams.entries())));
});

export async function GET(req: Request) {
  const response = await report(req);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
