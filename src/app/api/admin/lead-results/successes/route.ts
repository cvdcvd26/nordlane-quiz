import { requirePermanentAdmin } from "@/server/admin-auth";
import { json, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getLeadResultsSuccesses } from "@/server/services/lead-results";

const successes = route("admin.lead-results.successes", async (req: Request) => {
  const admin = await requirePermanentAdmin();
  await rateLimit(`admin-lead-results-successes:${admin.id}`, 60, 60);
  return json(await getLeadResultsSuccesses(Object.fromEntries(new URL(req.url).searchParams.entries())));
});

export async function GET(req: Request) {
  const response = await successes(req);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
