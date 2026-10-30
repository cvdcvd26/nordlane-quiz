import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { SignJWT } from "jose";
import { schema } from "@/db";
import { GET } from "@/app/api/files/[id]/route";
import { getOrCreateVisitorSessionId } from "@/server/visitor-session";
import { saveContact } from "@/server/services/contact";
import { uploadFile } from "@/server/services/uploads";
import { postAdminMessage } from "@/server/services/admin";
import { storage } from "@/server/storage";
import { PNG, setupTestEnv } from "./helpers";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
  set: (name: string, value: string) => jar.set(name, value),
}) }));

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let pdfBytes: Buffer;
const secret = "chat-file-downloads-test-secret-with-at-least-32-characters";
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (id: string, query = "") => new Request(`https://example.com/api/files/${id}${query}`);

async function sentFile(type = "application/pdf", name = "Umowa_Łucja_Żuk_(1).pdf") {
  const sessionId = await getOrCreateVisitorSessionId();
  await saveContact(sessionId, { name: "Download Test", phone: "600123456", telegram: "" });
  const [lead] = await env.db.select().from(schema.leads).where(eq(schema.leads.sessionId, sessionId));
  const file = await uploadFile({ sessionId, purpose: "chat", uploadedBy: "admin",
    file: { name, type, buffer: type === "application/pdf" ? pdfBytes : PNG } });
  const [message] = await postAdminMessage(lead.id, { clientMessageId: randomUUID(), body: "", fileIds: [file.id] });
  return { sessionId, file, message };
}

beforeAll(async () => {
  env = await setupTestEnv();
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]).drawText("Attachment download test");
  pdfBytes = Buffer.from(await pdf.save());
});
beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", secret);
  vi.restoreAllMocks();
  jar.clear();
  env.blobs.clear();
  await env.db.delete(schema.visitorSessions);
  await env.db.delete(schema.adminUsers);
  await env.db.delete(schema.appSettings);
  await env.db.delete(schema.rateLimits);
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await env.client.close(); });

describe("private chat attachment downloads", () => {
  it("downloads an already-sent PDF through both old and explicit download links with original bytes and Unicode name", async () => {
    const { file } = await sentFile();
    for (const query of ["", "?download"]) {
      const response = await GET(request(file.id, query), context(file.id));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("content-length")).toBe(String(pdfBytes.length));
      expect(response.headers.get("content-disposition")).toBe(
        'attachment; filename="Umowa__ucja__uk__1_.pdf"; filename*=UTF-8\'\'Umowa_%C5%81ucja_%C5%BBuk_%281%29.pdf');
      expect(response.headers.get("content-security-policy")).toContain("sandbox allow-downloads");
      expect(response.headers.get("content-security-policy")).not.toMatch(/allow-scripts|allow-same-origin/);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.equals(pdfBytes)).toBe(true);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    }
  });

  it("keeps image previews inline and supports explicit image downloads", async () => {
    const { file } = await sentFile("image/png", "screenshot.png");
    const preview = await GET(request(file.id), context(file.id));
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(preview.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(preview.headers.get("content-security-policy")).not.toContain("allow-downloads");
    expect(Buffer.from(await preview.arrayBuffer()).equals(PNG)).toBe(true);
    const download = await GET(request(file.id, "?download"), context(file.id));
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(download.headers.get("content-security-policy")).toContain("sandbox allow-downloads");
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("never reads storage for anonymous, foreign, unknown, unsent or deleted-message files", async () => {
    const { sessionId, file, message } = await sentFile();
    const ownerCookie = jar.get("nl_visitor")!;
    const read = vi.spyOn(storage(), "get");
    jar.clear();
    expect((await GET(request(file.id, "?download"), context(file.id))).status).toBe(404);
    await getOrCreateVisitorSessionId();
    expect((await GET(request(file.id, "?download"), context(file.id))).status).toBe(404);
    jar.set("nl_visitor", ownerCookie);
    for (const id of [randomUUID(), "not-a-file-id"]) {
      expect((await GET(request(id), context(id))).status).toBe(404);
    }
    const pending = await uploadFile({ sessionId, purpose: "chat", uploadedBy: "admin",
      file: { name: "pending.pdf", type: "application/pdf", buffer: pdfBytes } });
    expect((await GET(request(pending.id), context(pending.id))).status).toBe(404);
    await env.db.update(schema.messages).set({ deletedAt: new Date() }).where(eq(schema.messages.id, message.id));
    expect((await GET(request(file.id), context(file.id))).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("allows an authenticated administrator to download a PDF without the visitor cookie", async () => {
    const { file } = await sentFile();
    const [admin] = await env.db.insert(schema.adminUsers).values({ email: "download-admin@example.com", passwordHash: "unused" }).returning();
    jar.clear();
    jar.set("nl_admin", await new SignJWT({ v: admin.tokenVersion }).setProtectedHeader({ alg: "HS256" })
      .setSubject(admin.id).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret)));
    const response = await GET(request(file.id), context(file.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(Buffer.from(await response.arrayBuffer()).equals(pdfBytes)).toBe(true);
  });

  it("returns 404 when the authorized file's stored object is missing", async () => {
    const { file } = await sentFile();
    env.blobs.clear();
    expect((await GET(request(file.id), context(file.id))).status).toBe(404);
  });
});
