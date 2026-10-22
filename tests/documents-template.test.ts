import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG } from "./helpers";

type Stored = { stream: ReadableStream<Uint8Array>; size: number } | null;
const mocks = vi.hoisted(() => ({ get: vi.fn<(key: string) => Promise<Stored>>() }));
vi.mock("@/server/storage", () => ({ storage: () => ({ get: mocks.get }) }));

const content = [{ type: "heading", label: "§ 1", text: "Przedmiot umowy" },
  { type: "clause", label: "1.", text: "Przykładowa treść dokumentu." }];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const stored = (value: Uint8Array, size = value.byteLength): Stored => ({
  stream: new Blob([new Uint8Array(value)]).stream(), size,
});
function validStorage() {
  mocks.get.mockImplementation(async key => stored(key.endsWith("content.json") ? bytes(content) : PNG));
}

beforeEach(() => { vi.resetModules(); mocks.get.mockReset(); validStorage(); });

describe("private immutable contract template", () => {
  it("loads only the two fixed private keys, caches success and isolates cached data from callers", async () => {
    const { loadContractTemplate, CONTRACT_TEMPLATE_KEYS } = await import("@/server/documents/template");
    const [first, second] = await Promise.all([loadContractTemplate(), loadContractTemplate()]);
    expect(first.blocks).toEqual(content);
    expect(first.signature).toEqual(new Uint8Array(PNG));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get).toHaveBeenCalledWith(CONTRACT_TEMPLATE_KEYS.content);
    expect(mocks.get).toHaveBeenCalledWith(CONTRACT_TEMPLATE_KEYS.signature);
    first.blocks[0].text = "Changed by a caller";
    first.signature[0] = 0;
    expect(second.blocks).toEqual(content);
    expect((await loadContractTemplate()).signature[0]).toBe(137);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("reports missing assets safely and retries rather than caching a failure", async () => {
    mocks.get.mockResolvedValue(null);
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    validStorage();
    await expect(loadContractTemplate()).resolves.toMatchObject({ blocks: content });
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });

  it("never exposes or logs template content, storage failures or credentials in errors", async () => {
    const privateText = "private-person private-address secret-storage-token";
    mocks.get.mockRejectedValue(new Error(privateText));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { loadContractTemplate } = await import("@/server/documents/template");
      await expect(loadContractTemplate()).rejects.toMatchObject({
        status: 503, code: "document_template_unavailable",
        message: "The document template is unavailable. Please try again later.",
      });
      expect(errorLog).not.toHaveBeenCalled();
      expect(warnLog).not.toHaveBeenCalled();
      expect(infoLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore(); warnLog.mockRestore(); infoLog.mockRestore();
    }
  });

  it.each([
    [], {}, [{ type: "unknown", label: "1.", text: "Text" }],
    [{ type: "clause", label: "1.", text: "" }],
    [{ type: "clause", label: "1.", text: "private\ncontent" }],
    [{ type: "heading", label: "x".repeat(33), text: "Text" }],
    [{ type: "clause", label: "1.", text: "x".repeat(4001) }],
    [{ type: "clause", label: "1.", text: "Text", extra: "private" }],
    Array.from({ length: 201 }, () => ({ type: "clause", label: "1.", text: "Text" })),
  ])("rejects unbounded or malformed blocks safely (%#)", async invalid => {
    mocks.get.mockImplementation(async key => stored(key.endsWith("content.json") ? bytes(invalid) : PNG));
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
  });

  it("rejects malformed JSON, invalid UTF-8, and invalid PNG signatures or dimensions", async () => {
    const { validateContractTemplate } = await import("@/server/documents/template");
    for (const invalid of [new TextEncoder().encode("{private invalid JSON"), new Uint8Array([0xff])]) {
      expect(() => validateContractTemplate(invalid, PNG)).toThrowError("The document template is unavailable. Please try again later.");
    }
    const wrongMagic = new Uint8Array(PNG); wrongMagic[0] = 0;
    const oversizedImage = new Uint8Array(PNG); new DataView(oversizedImage.buffer).setUint32(16, 4097);
    for (const invalid of [new Uint8Array(), wrongMagic, oversizedImage]) {
      expect(() => validateContractTemplate(bytes(content), invalid)).toThrowError("The document template is unavailable. Please try again later.");
    }
  });

  it("enforces declared and streamed size limits without trusting storage metadata", async () => {
    const { loadContractTemplate, CONTRACT_TEMPLATE_LIMITS } = await import("@/server/documents/template");
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(bytes(content), CONTRACT_TEMPLATE_LIMITS.content + 1) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(new Uint8Array(CONTRACT_TEMPLATE_LIMITS.content + 1), 1) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(bytes(content), 1) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
  });
});
