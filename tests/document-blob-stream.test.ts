import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { get as getBlob } from "@vercel/blob";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { PNG } from "./helpers";

const blocks = [{ type: "clause", label: "1.", text: "Przykładowa treść dokumentu. ".repeat(30) }];
const content = Buffer.from(JSON.stringify(blocks));
const origin = "https://synthetic.private.blob.vercel-storage.com";
const token = "vercel_blob_rw_synthetic_test";
const originalDispatcher = getGlobalDispatcher();
let mock: MockAgent;
let observedSizes: number[];

beforeEach(async () => {
  vi.resetModules();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  observedSizes = [];
  const { setStorage } = await import("@/server/storage");
  setStorage({
    async get(key) {
      // Exercise the actual SDK's metadata and transparent HTTP decoding, without credentials or network.
      const response = await getBlob(key, { access: "private", useCache: false, token });
      if (!response || response.statusCode !== 200) return null;
      observedSizes.push(response.blob.size);
      return { stream: response.stream, size: response.blob.size };
    },
    put: vi.fn(),
    delete: vi.fn(),
  });
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mock.close();
});

function replySignature() {
  mock.get(origin).intercept({ path: "/system/documents/contract-v1/company-signature.png?cache=0", method: "GET" })
    .reply(200, PNG, { headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) } });
}

describe("private template HTTP stream metadata", () => {
  it("loads a valid SDK stream whose response has no Content-Length", async () => {
    mock.get(origin).intercept({ path: "/system/documents/contract-v1/content.json?cache=0", method: "GET" })
      .reply(200, content, { headers: { "content-type": "application/json" } });
    replySignature();
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).resolves.toMatchObject({ blocks });
    expect(observedSizes).toContain(0);
    mock.assertNoPendingInterceptors();
  });

  it("loads a gzip-decoded SDK stream when Content-Length describes compressed bytes", async () => {
    const compressed = gzipSync(content);
    expect(compressed.byteLength).toBeLessThan(content.byteLength);
    mock.get(origin).intercept({ path: "/system/documents/contract-v1/content.json?cache=0", method: "GET" })
      .reply(200, compressed, { headers: {
        "content-type": "application/json", "content-encoding": "gzip", "content-length": String(compressed.byteLength),
      } });
    replySignature();
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).resolves.toMatchObject({ blocks });
    expect(observedSizes).toContain(compressed.byteLength);
    mock.assertNoPendingInterceptors();
  });
});
