import { fileTypeFromBuffer } from "file-type";
import { badRequest } from "./errors";
import { content } from "@/config/content";

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type ValidatedFile = { mime: string; ext: string; size: number; displayName: string };

/**
 * Checks size, the declared MIME type and the real type detected from the file's bytes.
 * A renamed .exe with image/png declared is rejected because its magic bytes don't match.
 */
export async function validateFile(
  input: { name: string; declaredType: string; buffer: Buffer },
  opts: { allowed: readonly string[]; maxBytes: number },
): Promise<ValidatedFile> {
  if (input.buffer.length === 0) throw badRequest(content.errors.fileType, "file_empty");
  if (input.buffer.length > opts.maxBytes)
    throw badRequest(content.errors.fileSize(Math.round(opts.maxBytes / 1024 / 1024)), "file_size");
  if (!opts.allowed.includes(input.declaredType)) throw badRequest(content.errors.fileType, "file_type");

  const detected = await fileTypeFromBuffer(input.buffer);
  if (!detected || detected.mime !== input.declaredType || !opts.allowed.includes(detected.mime))
    throw badRequest(content.errors.fileContent, "file_content");

  return {
    mime: detected.mime,
    ext: EXT[detected.mime] ?? detected.ext,
    size: input.buffer.length,
    displayName: safeDisplayName(input.name, EXT[detected.mime] ?? detected.ext),
  };
}

/** Name shown in the UI / Content-Disposition. Storage keys never use it. */
export function safeDisplayName(name: string, ext: string) {
  const base = name
    .normalize("NFKC")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} _().-]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "file"}.${ext}`;
}
