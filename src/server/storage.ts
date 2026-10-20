import { put, get, del } from "@vercel/blob";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

/** Object storage for user files. Every file is private: it is only served through /api/files/[id]. */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
}

const vercelBlobStorage: FileStorage = {
  async put(key, data, contentType) {
    await put(key, data, { access: "private", contentType, addRandomSuffix: false });
  },
  async get(key) {
    const res = await get(key, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return { stream: res.stream, size: res.blob.size };
  },
  async delete(key) {
    await del(key);
  },
};

/**
 * Local development only: without BLOB_READ_WRITE_TOKEN, files go to ./.data (gitignored).
 * Never used on Vercel — there the Blob token is required.
 */
function localPath(key: string) {
  if (process.env.NODE_ENV === "production" && !process.env.UPLOAD_DIR)
    throw new Error("Set UPLOAD_DIR to a persistent directory or configure BLOB_READ_WRITE_TOKEN in production");
  // Runtime uploads are external data, never deployment assets.
  return path.join(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || path.join(process.cwd(), ".data"), key);
}

const localDiskStorage: FileStorage = {
  async put(key, data) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  async get(key) {
    try {
      const data = await readFile(/*turbopackIgnore: true*/ localPath(key));
      return { stream: new Blob([new Uint8Array(data)]).stream(), size: data.length };
    } catch {
      return null;
    }
  },
  async delete(key) {
    await rm(localPath(key), { force: true });
  },
};

const useLocal = !process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL && process.env.NODE_ENV !== "test";
let current: FileStorage = useLocal ? localDiskStorage : vercelBlobStorage;
export const storage = () => current;
/** Test hook. */
export const setStorage = (s: FileStorage | null) => {
  current = s ?? (useLocal ? localDiskStorage : vercelBlobStorage);
};
