import { route, json } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { listTestimonials } from "@/server/services/testimonials";

export const GET = route("admin.testimonials", async (req: Request) => {
  await requireAdmin();
  return json(await listTestimonials(Object.fromEntries(new URL(req.url).searchParams.entries())));
});
