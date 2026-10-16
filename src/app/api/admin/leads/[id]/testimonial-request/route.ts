import { route, json, assertSameOrigin } from "@/server/http";
import { requireAdmin } from "@/server/admin-auth";
import { postAdminMessage } from "@/server/services/admin";
import { requestTestimonial } from "@/server/services/testimonials";
import { leadIdFrom } from "../../lead-id";

export const POST = route("admin.testimonial.request", async (req: Request, ctx: RouteContext<"/api/admin/leads/[id]/testimonial-request">) => {
  assertSameOrigin(req);
  await requireAdmin();
  return json(await requestTestimonial(leadIdFrom((await ctx.params).id), postAdminMessage));
});
