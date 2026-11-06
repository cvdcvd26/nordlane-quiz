import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.resetModules(); mocks.get.mockReset(); validStorage();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("private immutable contract template", () => {
  it("loads only the content key, never the old signature, caches success and isolates cached blocks", async () => {
    const { loadContractTemplate, CONTRACT_TEMPLATE_KEYS } = await import("@/server/documents/template");
    const [first, second] = await Promise.all([loadContractTemplate(), loadContractTemplate()]);
    expect(first.blocks).toEqual(content);
    expect(first).not.toHaveProperty("signature");
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(CONTRACT_TEMPLATE_KEYS.content);
    expect(mocks.get).not.toHaveBeenCalledWith("system/documents/contract-v1/company-signature.png");
    expect(CONTRACT_TEMPLATE_KEYS.content).toBe("system/documents/contract-itsoluttionspol-v2/content.json");
    first.blocks[0].text = "Changed by a caller";
    expect(second.blocks).toEqual(content);
    expect((await loadContractTemplate()).blocks).toEqual(content);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("reports missing assets safely and retries rather than caching a failure", async () => {
    mocks.get.mockResolvedValue(null);
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    validStorage();
    await expect(loadContractTemplate()).resolves.toMatchObject({ blocks: content });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("logs only fixed diagnostic phases and never exposes private storage failures or credentials", async () => {
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
      expect(warnLog.mock.calls).toEqual([
        ["documents.template.unavailable", { phase: "content_read" }],
      ]);
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

  it("rejects malformed JSON and invalid UTF-8 without requiring any signature resource", async () => {
    const { validateContractTemplate } = await import("@/server/documents/template");
    for (const invalid of [new TextEncoder().encode("{private invalid JSON"), new Uint8Array([0xff])]) {
      expect(() => validateContractTemplate(invalid)).toThrowError("The document template is unavailable. Please try again later.");
    }
    expect(validateContractTemplate(bytes([...content, { type: "paragraph", label: "", text: "Nowy akapit wprowadzenia." }])).blocks).toHaveLength(3);
  });

  it.each([0, 1, 8, Number.NaN])("accepts valid bounded streams when HTTP metadata size is missing or compressed (%s)", async size => {
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(bytes(content), size) : stored(PNG));
    const { loadContractTemplate } = await import("@/server/documents/template");
    await expect(loadContractTemplate()).resolves.toMatchObject({ blocks: content });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("enforces metadata upper bounds, actual stream limits, and nonempty streams", async () => {
    const { loadContractTemplate, CONTRACT_TEMPLATE_LIMITS } = await import("@/server/documents/template");
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(bytes(content), CONTRACT_TEMPLATE_LIMITS.content + 1) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(new Uint8Array(CONTRACT_TEMPLATE_LIMITS.content + 1), 1) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
    mocks.get.mockImplementation(async key => key.endsWith("content.json")
      ? stored(new Uint8Array(), 0) : stored(PNG));
    await expect(loadContractTemplate()).rejects.toMatchObject({ status: 503, code: "document_template_unavailable" });
  });
});
