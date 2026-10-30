// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { content } from "@/config/content";
import type { PublicFile } from "@/lib/api";

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api, uploadWithProgress: mocks.upload,
}));
vi.mock("@/components/ui/SoundToggle", () => ({ SoundToggle: () => null }));
vi.mock("@/components/chat/ManagerAvatar", () => ({ ManagerAvatar: () => null }));

import { VisitorChat } from "@/components/visitor/VisitorChat";

let host: HTMLDivElement;
let root: Root;
const pdf: PublicFile = { id: "1231ad17-e0c1-4fa1-9517-e6c875e41716", name: "Umowa_Zofia_Żółć.pdf", mime: "application/pdf", size: 1024, url: "/api/files/1231ad17-e0c1-4fa1-9517-e6c875e41716" };
const sendButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === content.chat.send)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.api.mockReset(); mocks.upload.mockReset();
  mocks.api.mockImplementation(async (_url: string, init?: { method?: string; json?: { clientMessageId: string; body: string; fileIds: string[] } }) => {
    if (init?.method === "POST") return { message: { id: "sent-pdf", clientMessageId: init.json!.clientMessageId,
      sequence: "1", sender: "visitor", body: init.json!.body, createdAt: "2026-10-30T10:00:00.000Z", files: [pdf] } };
    return { messages: [], nextCursor: null, previousCursor: null, hasMore: false, attachmentsEnabled: true,
      outcome: null, manager: { id: "maja", name: "Maja (HR)", avatar: "/maja-hr.png" },
      changes: { updates: [], deletedIds: [], cursor: "0", hasMore: false } };
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

describe("visitor PDF chat attachments", () => {
  it.each([true, false])("selects, uploads and sends a PDF-only message in collapsible=%s chat", async collapsible => {
    let completeUpload!: (value: { file: PublicFile }) => void;
    mocks.upload.mockReturnValue({ promise: new Promise<{ file: PublicFile }>(resolve => { completeUpload = resolve; }) });
    await act(async () => root.render(<VisitorChat collapsible={collapsible} />));
    if (collapsible) await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls="visitor-chat-panel"]')!.click());
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept.split(",")).toEqual(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
    const selected = new File(["%PDF-1.7\n%%EOF"], pdf.name, { type: "application/pdf" });
    Object.defineProperty(input, "files", { configurable: true, value: [selected] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(mocks.upload).toHaveBeenCalledOnce();
    const [url, form] = mocks.upload.mock.calls[0] as [string, FormData];
    expect(url).toBe("/api/uploads");
    expect(form.get("purpose")).toBe("chat");
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe(pdf.name);
    expect(uploaded.type).toBe("application/pdf");
    expect(sendButton().disabled).toBe(true);
    await act(async () => completeUpload({ file: pdf }));
    expect(host.textContent).toContain(pdf.name);
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    expect(mocks.api).toHaveBeenCalledWith("/api/chat", { method: "POST", json: {
      clientMessageId: expect.any(String), body: "", fileIds: [pdf.id],
    } });
    expect(host.querySelector<HTMLAnchorElement>('a[download]')?.download).toBe(pdf.name);
    expect(host.querySelector('input[type="file"]')).toBe(input);
    expect(sendButton().disabled).toBe(true);
  });
});
