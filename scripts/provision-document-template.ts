import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

/**
 * Keeps private assets outside the public Git repository:
 * node --conditions=react-server --import tsx scripts/provision-document-template.ts <asset-directory> [--local]
 * With BLOB_READ_WRITE_TOKEN, storage.put explicitly requests private Blob access.
 * Without the token (or with --local), the existing adapter writes to gitignored .data.
 */
async function main() {
  const [directory, flag, ...extra] = process.argv.slice(2);
  if (!directory || (flag && flag !== "--local") || extra.length) {
    throw new Error("Usage: node --conditions=react-server --import tsx scripts/provision-document-template.ts <asset-directory> [--local]");
  }
  loadEnvConfig(process.cwd());
  if (flag === "--local") {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.VERCEL;
    if (process.env.NODE_ENV === "production") throw new Error("Local provisioning requires a development environment.");
  }
  const root = await realpath(process.cwd());
  const input = await realpath(path.resolve(directory));
  const relative = path.relative(root, input);
  if (!relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error("The private asset directory must be outside the application repository.");
  }
  // Dynamic imports ensure the storage adapter is selected after .env files have loaded.
  const { storage } = await import("../src/server/storage");
  const { CONTRACT_TEMPLATE_KEYS, CONTRACT_TEMPLATE_LIMITS, validateContractTemplate } = await import("../src/server/documents/template");
  const boundedFile = async (filename: string, limit: number) => {
    const file = path.join(input, filename);
    const details = await stat(file);
    if (!details.isFile() || details.size < 1 || details.size > limit) throw new Error("Invalid private template asset.");
    const data = await readFile(file);
    if (data.length > limit) throw new Error("Invalid private template asset.");
    return data;
  };
  const [content, signature] = await Promise.all([
    boundedFile("contract-content.json", CONTRACT_TEMPLATE_LIMITS.content),
    boundedFile("company-signature.png", CONTRACT_TEMPLATE_LIMITS.signature),
  ]);
  validateContractTemplate(content, signature);
  const target = storage();
  const storeImmutable = async (key: string, data: Buffer, contentType: string) => {
    const existing = await target.get(key);
    if (existing) {
      if (existing.size !== data.byteLength) throw new Error("The private template version already exists.");
      const reader = existing.stream.getReader();
      let offset = 0;
      let matches = true;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (offset + chunk.value.byteLength > data.byteLength ||
              !data.subarray(offset, offset + chunk.value.byteLength).equals(chunk.value)) {
            matches = false;
            await reader.cancel();
            break;
          }
          offset += chunk.value.byteLength;
        }
      } finally {
        reader.releaseLock();
      }
      if (!matches || offset !== data.byteLength) throw new Error("The private template version already exists.");
      return;
    }
    await target.put(key, data, contentType);
  };
  // Existing Vercel adapter uses access:"private"; a public Blob store is rejected by the SDK.
  // Identical existing files are skipped so a partial upload can be retried without overwriting this version.
  await storeImmutable(CONTRACT_TEMPLATE_KEYS.signature, signature, "image/png");
  await storeImmutable(CONTRACT_TEMPLATE_KEYS.content, content, "application/json");
  console.log(process.env.BLOB_READ_WRITE_TOKEN ? "Private document template provisioned." : "Local document template provisioned in ignored storage.");
}

void main().catch(() => {
  console.error("Document template provisioning failed. Check the private asset directory, storage configuration and CLI usage.");
  process.exitCode = 1;
});
