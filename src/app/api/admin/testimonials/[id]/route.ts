import { z } from "zod";
import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { notFound } from "@/server/errors";
import { content } from "@/config/content";
import { deleteTestimonial, updateTestimonial } from "@/server/services/testimonials";

const idFrom = (raw: string) => {
  const parsed = z.string().uuid().safeParse(raw);
  if (!parsed.success) throw notFound(content.admin.testimonials.notFound);
  return parsed.data;
};

export const PATCH = route("admin.testimonial.patch", async (req: Request, ctx: RouteContext<"/api/admin/testimonials/[id]">) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json({ testimonial: await updateTestimonial(idFrom((await ctx.params).id), await readJson(req)) });
});

export const DELETE = route("admin.testimonial.delete", async (req: Request, ctx: RouteContext<"/api/admin/testimonials/[id]">) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json(await deleteTestimonial(idFrom((await ctx.params).id)));
});
