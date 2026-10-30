import { route } from "@/server/http";
import { getAdmin } from "@/server/admin-auth";
import { getVisitorSessionId } from "@/server/visitor-session";
import { getReadableFile } from "@/server/services/uploads";
import { storage } from "@/server/storage";
import { notFound } from "@/server/errors";

/**
 * The only way to read an uploaded file. Storage is private; access is checked on every request.
 * Unknown and foreign files both return 404 so ids can't be probed.
 */
export const GET = route("files.get", async (req: Request, ctx: RouteContext<"/api/files/[id]">) => {
  const { id } = await ctx.params;
  const admin = await getAdmin();
  const sessionId = admin ? null : await getVisitorSessionId();
  if (!admin && !sessionId) throw notFound();

  const file = await getReadableFile(id, admin ? { admin: true } : { sessionId: sessionId! });
  if (!file) throw notFound();
  const blob = await storage().get(file.storageKey);
  if (!blob) throw notFound();

  // PDFs are downloads even for existing chat links without a query string.
  // Sandboxed inline PDF viewers can otherwise prevent users from saving them.
  const download = file.mimeType === "application/pdf" || new URL(req.url).searchParams.has("download");
  const name = encodeURIComponent(file.originalName).replace(/['()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const fallbackName = file.originalName.replace(/[^a-zA-Z0-9._ -]/g, "_") || "file";
  return new Response(blob.stream, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(blob.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fallbackName}"; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox${download ? " allow-downloads" : ""}`,
    },
  });
});
