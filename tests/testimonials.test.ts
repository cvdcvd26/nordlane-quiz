import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setupTestEnv } from "./helpers";
import { schema } from "@/db";
import { unauthorized } from "@/server/errors";
import {
  createTestimonial,
  deleteTestimonial,
  listPublishedTestimonials,
  listTestimonials,
  updateTestimonial,
} from "@/server/services/testimonials";
import { GET, POST } from "@/app/api/admin/testimonials/route";
import { PATCH, DELETE } from "@/app/api/admin/testimonials/[id]/route";

const auth = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/server/admin-auth", () => ({
  requireAdmin: async () => {
    if (!auth.allowed) throw unauthorized();
    return { id: "test-admin" };
  },
}));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
beforeAll(async () => { env = await setupTestEnv(); });
beforeEach(async () => {
  auth.allowed = true;
  await env.db.delete(schema.testimonials);
});
afterAll(async () => { await env.client.close(); });

const review = { name: "Anna", rating: 5, body: "Wszystkie kroki zadania były jasne." };
const request = (method: string, data?: unknown, origin = "https://example.com") => new Request(
  "https://example.com/api/admin/testimonials",
  { method, headers: { host: "example.com", origin, "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) },
);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin-created public testimonials", () => {
  it("stores multiple manual entries without creating sessions or leads and only publishes approved entries", async () => {
    const draft = await createTestimonial(review);
    const published = await createTestimonial({ ...review, name: " Anna K. ", city: " Warszawa ", age: 29, status: "published" });
    expect(draft).toMatchObject({ status: "pending", city: null, age: null, publishedAt: null });
    expect(published).toMatchObject({ name: "Anna K.", city: "Warszawa", age: 29, status: "published" });
    expect(published.publishedAt).not.toBeNull();
    const [stored] = await env.db.select().from(schema.testimonials).where(eq(schema.testimonials.id, published.id));
    expect(stored.sessionId).toBeNull();
    expect(await env.db.select().from(schema.visitorSessions)).toHaveLength(0);
    expect(await env.db.select().from(schema.leads)).toHaveLength(0);
    expect(await listPublishedTestimonials()).toEqual([
      { id: published.id, name: "Anna K.", city: "Warszawa", age: 29, rating: 5, body: review.body },
    ]);
    const list = await listTestimonials({});
    expect(list.total).toBe(2);
    expect(list.items.find((t) => t.id === published.id)).toMatchObject({ city: "Warszawa", age: 29, leadId: null, leadStatus: null });
  });

  it("edits content without changing publication order, clears optional details, and hides published entries", async () => {
    const original = await createTestimonial({ ...review, city: "Lublin", age: 40, status: "published" });
    const edited = await updateTestimonial(original.id, { name: "Maria", body: "Uaktualniony tekst opinii o zadaniu.", status: "published" });
    expect(edited).toMatchObject({ name: "Maria", city: "Lublin", age: 40, publishedAt: original.publishedAt });
    const cleared = await updateTestimonial(original.id, { city: "  ", age: null });
    expect(cleared).toMatchObject({ city: null, age: null, status: "published", name: "Maria" });
    expect((await listPublishedTestimonials())[0].body).toBe(edited.body);
    const hidden = await updateTestimonial(original.id, { status: "pending" });
    expect(hidden.publishedAt).toBeNull();
    expect(await listPublishedTestimonials()).toHaveLength(0);
    await deleteTestimonial(original.id);
    expect((await listTestimonials({})).total).toBe(0);
    await expect(updateTestimonial(original.id, { name: "Anna" })).rejects.toMatchObject({ status: 404 });
  });

  it("validates demographic limits, required content and edit fields on the server", async () => {
    for (const invalid of [
      { name: " " }, { name: "a".repeat(41) }, { body: "krótko" }, { body: "a".repeat(601) },
      { rating: 0 }, { rating: 6 }, { rating: 1.5 }, { city: "a".repeat(101) },
      { age: 0 }, { age: 121 }, { age: 29.5 }, { age: "29" }, { status: "invalid" },
      { sessionId: randomUUID() },
    ]) await expect(createTestimonial({ ...review, ...invalid })).rejects.toThrow();
    const valid = await createTestimonial({ ...review, city: "a".repeat(100), age: 120 });
    await expect(updateTestimonial(valid.id, {})).rejects.toThrow();
    await expect(updateTestimonial(valid.id, { sessionId: randomUUID() })).rejects.toThrow();
    await expect(updateTestimonial(valid.id, { age: -1 })).rejects.toThrow();
  });
});

describe("admin testimonial HTTP permissions", () => {
  it("requires admin authentication for listing, creation, edits and deletion", async () => {
    const t = await createTestimonial(review);
    auth.allowed = false;
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", review))).status).toBe(401);
    expect((await PATCH(request("PATCH", { name: "Maria" }), ctx(t.id))).status).toBe(401);
    expect((await DELETE(request("DELETE"), ctx(t.id))).status).toBe(401);
    expect((await listTestimonials({})).items[0].name).toBe("Anna");
  });

  it("rejects cross-origin writes and exposes validated creation/editing responses", async () => {
    expect((await POST(request("POST", review, "https://attacker.example"))).status).toBe(403);
    const response = await POST(request("POST", { ...review, city: "Lublin", age: 31, status: "published" }));
    expect(response.status).toBe(201);
    const { testimonial } = await response.json();
    expect(testimonial).toMatchObject({ city: "Lublin", age: 31, status: "published" });
    expect((await PATCH(request("PATCH", { name: "Changed" }, "https://attacker.example"), ctx(testimonial.id))).status).toBe(403);
    expect((await DELETE(request("DELETE", undefined, "https://attacker.example"), ctx(testimonial.id))).status).toBe(403);
    const edited = await PATCH(request("PATCH", { name: "Maria", age: 32 }), ctx(testimonial.id));
    expect(edited.status).toBe(200);
    expect((await edited.json()).testimonial).toMatchObject({ name: "Maria", age: 32, city: "Lublin" });
    expect((await PATCH(request("PATCH", { age: 121 }), ctx(testimonial.id))).status).toBe(400);
    expect((await PATCH(request("PATCH", { name: "Anna" }), ctx("invalid-id"))).status).toBe(404);
  });
});
