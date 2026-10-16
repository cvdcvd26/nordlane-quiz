import { route, json, assertSameOrigin, readJson } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { submitTestimonial } from "@/server/services/testimonials";
import { rateLimit } from "@/server/rate-limit";

/** Visitor sends a review (only after the manager asked for one). */
export const POST = route("testimonial.post", async (req: Request) => {
  assertSameOrigin(req);
  const sessionId = await requireVisitorSessionId();
  await rateLimit(`testimonial:${sessionId}`, 10, 600);
  return json({ testimonial: await submitTestimonial(sessionId, await readJson(req)) }, 201);
});
