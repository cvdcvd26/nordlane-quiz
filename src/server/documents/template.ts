import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { storage } from "@/server/storage";

export const CONTRACT_TEMPLATE_KEYS = {
  content: "system/documents/contract-v1/content.json",
  signature: "system/documents/contract-v1/company-signature.png",
} as const;
export const CONTRACT_TEMPLATE_LIMITS = { content: 256 * 1024, signature: 512 * 1024 } as const;

const printable = (max: number) => z.string().max(max).refine(value => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
const blocksSchema = z.array(z.object({
  type: z.enum(["heading", "clause", "subclause"]),
  label: printable(32),
  text: printable(4000).refine(value => value.trim().length > 0),
}).strict()).min(1).max(200);

export type ContractTemplateBlock = z.infer<typeof blocksSchema>[number];
export type ContractTemplate = { blocks: ContractTemplateBlock[]; signature: Uint8Array };

const unavailable = () => new AppError(503, "document_template_unavailable", "The document template is unavailable. Please try again later.");

/** Also used by the provisioning CLI; it must validate both files before writing either. */
export function validateContractTemplate(content: Uint8Array, signature: Uint8Array): ContractTemplate {
  try {
    if (!content.byteLength || content.byteLength > CONTRACT_TEMPLATE_LIMITS.content ||
        signature.byteLength < 33 || signature.byteLength > CONTRACT_TEMPLATE_LIMITS.signature) throw unavailable();
    const blocks = blocksSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)));
    const png = new DataView(signature.buffer, signature.byteOffset, signature.byteLength);
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!magic.every((byte, index) => signature[index] === byte) || png.getUint32(8) !== 13 ||
        png.getUint32(12) !== 0x49484452 || !png.getUint32(16) || !png.getUint32(20) ||
        png.getUint32(16) > 4096 || png.getUint32(20) > 4096) throw unavailable();
    return { blocks, signature: new Uint8Array(signature) };
  } catch {
    // Neither the private template content nor storage errors belong in public errors or logs.
    throw unavailable();
  }
}

async function readPrivateFile(key: string, limit: number) {
  const file = await storage().get(key);
  if (!file) throw unavailable();
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit) {
    await file.stream.cancel().catch(() => {});
    throw unavailable();
  }
  const reader = file.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw unavailable(); }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== file.size) throw unavailable();
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

// Only this fixed version of the template is cached; candidate fields and generated PDFs never enter it.
let cached: Promise<ContractTemplate> | undefined;
export async function loadContractTemplate(): Promise<ContractTemplate> {
  if (!cached) {
    cached = Promise.all([
      readPrivateFile(CONTRACT_TEMPLATE_KEYS.content, CONTRACT_TEMPLATE_LIMITS.content),
      readPrivateFile(CONTRACT_TEMPLATE_KEYS.signature, CONTRACT_TEMPLATE_LIMITS.signature),
    ]).then(([content, signature]) => validateContractTemplate(content, signature)).catch(() => {
      cached = undefined;
      throw unavailable();
    });
  }
  const template = await cached;
  // Return isolated copies so callers cannot alter the cached immutable version.
  return { blocks: template.blocks.map(block => ({ ...block })), signature: new Uint8Array(template.signature) };
}
