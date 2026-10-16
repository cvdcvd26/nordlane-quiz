import { connection } from "next/server";
import { route, json } from "@/server/http";
import { listPublishedTestimonials } from "@/server/services/testimonials";

/** Published reviews for the first screen (public, no session needed). */
export const GET = route("testimonials.list", async () => {
  // Always read live data: without this the list would be frozen at build time.
  await connection();
  return json({ items: await listPublishedTestimonials() });
});
