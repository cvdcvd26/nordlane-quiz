import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { createTestimonial, listTestimonials } from "@/server/services/testimonials";

export const GET = route("admin.testimonials", async (req: Request) => {
  await requireAdmin();
  return json(await listTestimonials(Object.fromEntries(new URL(req.url).searchParams.entries())));
});

export const POST = route("admin.testimonials.create", async (req: Request) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json({ testimonial: await createTestimonial(await readJson(req)) }, 201);
});
