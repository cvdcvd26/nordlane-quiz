import { AppError } from "./errors";
import { content } from "@/config/content";

/** Enforce actual streamed bytes, even without Content-Length. */
export async function readBody(req: Request, limit: number): Promise<Buffer> {
  const tooLarge = () => new AppError(413, "body_size", content.errors.badRequest);
  if (Number(req.headers.get("content-length")) > limit) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw tooLarge(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
