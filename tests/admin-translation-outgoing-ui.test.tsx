// @vitest-environment happy-dom
import { act, type ChangeEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDicts } from "@/config/admin-i18n";
import { translationCopy, type TranslationStatus } from "@/config/chat-translation";
import type { PublicFile } from "@/lib/api";
import type { RichTextDocument } from "@/lib/rich-text";
import type { RichTextEditorProps } from "@/components/admin/RichTextEditor";

const mocks = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api, uploadWithProgress: mocks.upload }));
vi.mock("@/components/admin/i18n", () => ({ useAdminI18n: () => ({ lang: "ru", t: adminDicts.ru, err: (error: Error) => error.message }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("next/dynamic", () => ({ default: () => function TestEditor({ id, label, value, onChange, disabled, onSubmit }: RichTextEditorProps) {
  return <div>
    <textarea id={id} aria-label={label} value={value.body} disabled={disabled} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange({ body: event.target.value, bodyRich: null })}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit?.(); } }} />
    <button type="button" aria-label={`Bold ${label}`} disabled={disabled} onClick={() => onChange({ body: value.body, bodyRich: { version: 1, runs: [{ text: value.body, bold: true }] } })}>B</button>
  </div>;
} }));

import { AdminChatComposer } from "@/components/admin/AdminChatComposer";

const L = translationCopy.ru;
const ready: TranslationStatus = { enabled: true, reason: null, usedUsd: 0, limitUsd: 5 };
const translated = { body: "Dziękujemy za wiadomość.", bodyRich: { version: 1 as const, runs: [{ text: "Dziękujemy za wiadomość.", bold: true as const }] } };
const pdf: PublicFile = { id: "1231ad17-e0c1-4fa1-9517-e6c875e41716", name: "test.pdf", mime: "application/pdf", size: 12, url: "/api/files/test" };
let host: HTMLDivElement;
let root: Root;
type Send = (body: string, files: PublicFile[], bodyRich?: RichTextDocument | null) => Promise<void>;
let onSend: ReturnType<typeof vi.fn<Send>>;
let status: TranslationStatus;
let translate: (input: unknown) => Promise<unknown>;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const editor = () => host.querySelector<HTMLTextAreaElement>('textarea[id="composer"]')!;
const preview = () => host.querySelector<HTMLTextAreaElement>('textarea[id^="translation-preview-"]');
const render = (leadId = "7") => act(async () => root.render(<AdminChatComposer leadId={leadId} onSend={onSend} />));
const click = (element: HTMLElement) => act(async () => { element.click(); });
async function type(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  status = ready;
  translate = async () => translated;
  onSend = vi.fn<Send>().mockResolvedValue(undefined);
  mocks.api.mockReset(); mocks.upload.mockReset();
  mocks.api.mockImplementation(async (url: string, init?: { json?: unknown }) => {
    if (url === "/api/admin/translation") return status;
    if (url === "/api/admin/quick-replies") return { replies: [{ id: "test-template", title: "Polish template", body: "Dziękujemy", bodyRich: { version: 1, runs: [{ text: "Dziękujemy", underline: true }] } }] };
    if (url.endsWith("/translations")) return translate(init?.json);
    throw new Error(`Unexpected request: ${url}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("admin Russian to Polish preview", () => {
  it("requires review before sending and only sends the Polish preview, retaining rich marks", async () => {
    await render(); await type(editor(), "Спасибо за сообщение.");
    await click(button(`B`));
    await click(button(L.prepare));
    expect(onSend).not.toHaveBeenCalled();
    expect(editor().value).toBe("Спасибо за сообщение.");
    expect(preview()?.value).toBe(translated.body);
    expect(mocks.api).toHaveBeenCalledWith("/api/admin/leads/7/translations", expect.objectContaining({ json: { kind: "draft", body: "Спасибо за сообщение.", bodyRich: { version: 1, runs: [{ text: "Спасибо за сообщение.", bold: true }] } } }));
    await click(button(L.sendPolish));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith(translated.body, [], translated.bodyRich);
    expect(editor().value).toBe(""); expect(preview()).toBeNull();
  });

  it("allows editing the Polish result and invalidates it when the Russian source changes", async () => {
    await render(); await type(editor(), "Спасибо."); await click(button(L.prepare));
    await type(preview()!, "Dziękuję bardzo."); await click(button(L.sendPolish));
    expect(onSend).toHaveBeenCalledWith("Dziękuję bardzo.", [], null);
    await type(editor(), "Следующий ответ."); await click(button(L.prepare));
    await type(editor(), "Исправленный ответ.");
    expect(preview()).toBeNull(); expect(button(L.sendPolish)).toBeUndefined();
    expect(editor().value).toBe("Исправленный ответ.");
  });

  it("keeps the Russian draft on translation failure and never falls back to sending Russian", async () => {
    translate = async () => { throw new Error("Provider unavailable"); };
    await render(); await type(editor(), "Сохраните этот ответ."); await click(button(L.prepare));
    expect(editor().value).toBe("Сохраните этот ответ."); expect(onSend).not.toHaveBeenCalled();
    expect(host.textContent).toContain(L.draftFailed);
  });

  it("preserves both drafts on send failure and blocks duplicate final sends", async () => {
    onSend.mockRejectedValueOnce(new Error("Network"));
    await render(); await type(editor(), "Спасибо."); await click(button(L.prepare)); await click(button(L.sendPolish));
    expect(editor().value).toBe("Спасибо."); expect(preview()?.value).toBe(translated.body);
    expect(host.textContent).toContain(L.sendFailed);
    let finish!: () => void;
    onSend.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => { button(L.sendPolish).click(); button(L.sendPolish).click(); });
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(editor().disabled).toBe(true);
    await act(async () => finish()); expect(editor().value).toBe("");
  });

  it("keeps attachments for review and invalidates preview when they are removed", async () => {
    mocks.upload.mockReturnValue({ promise: Promise.resolve({ file: pdf }) });
    await render(); await type(editor(), "Вот документ.");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF"], pdf.name, { type: pdf.mime })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click(button(L.prepare)); expect(host.textContent).toContain(pdf.name);
    mocks.api.mockResolvedValueOnce({});
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Удалить test.pdf"]')!);
    expect(preview()).toBeNull();
    await click(button(L.prepare)); await click(button(L.sendPolish));
    expect(onSend).toHaveBeenCalledWith(translated.body, [], translated.bodyRich);
  });

  it("sends the reviewed Polish text with the already uploaded PDF", async () => {
    mocks.upload.mockReturnValue({ promise: Promise.resolve({ file: pdf }) });
    await render(); await type(editor(), "Прикрепляю документ.");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["%PDF"], pdf.name, { type: pdf.mime })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click(button(L.prepare)); expect(onSend).not.toHaveBeenCalled();
    await click(button(L.sendPolish));
    expect(onSend).toHaveBeenCalledWith(translated.body, [pdf], translated.bodyRich);
    expect(mocks.upload).toHaveBeenCalledOnce();
  });

  it("sends existing Polish templates directly in explicit Polish mode without translating twice", async () => {
    await render(); await click(button(L.polishMode));
    const select = host.querySelector<HTMLSelectElement>("#composer-quick-reply")!;
    await act(async () => { select.value = "test-template"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click(button(adminDicts.ru.chat.send));
    expect(onSend).toHaveBeenCalledWith("Dziękujemy", [], { version: 1, runs: [{ text: "Dziękujemy", underline: true }] });
    expect(mocks.api.mock.calls.filter(([url]) => String(url).endsWith("/translations"))).toHaveLength(0);
  });

  it("discards an in-flight result after switching to another lead", async () => {
    let finish!: (value: unknown) => void;
    translate = () => new Promise(resolve => { finish = resolve; });
    await render(); await type(editor(), "Текст для первого лида.");
    await click(button(L.prepare)); await render("8");
    await act(async () => finish(translated));
    expect(preview()).toBeNull(); expect(editor().value).toBe(""); expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps existing Polish messaging available when the translator is unconfigured", async () => {
    status = { ...ready, enabled: false, reason: "not_configured" };
    await render(); expect(host.textContent).toContain(L.unavailable);
    await type(editor(), "Dzień dobry."); await click(button(adminDicts.ru.chat.send));
    expect(onSend).toHaveBeenCalledWith("Dzień dobry.", [], null);
  });

  it("blocks Russian translation at the budget cap until explicit Polish mode is selected", async () => {
    status = { ...ready, enabled: false, reason: "limit_reached" };
    await render(); await type(editor(), "Русский черновик."); await click(button(L.prepare));
    expect(onSend).not.toHaveBeenCalled(); expect(host.textContent).toContain(L.limit);
    await click(button(L.polishMode)); await type(editor(), "Polska odpowiedź."); await click(button(adminDicts.ru.chat.send));
    expect(onSend).toHaveBeenCalledWith("Polska odpowiedź.", [], null);
  });

  it("fails closed if connection status cannot be loaded while allowing explicit Polish mode", async () => {
    const implementation = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((url: string, init?: unknown) => url === "/api/admin/translation" ? Promise.reject(new Error("Offline")) : implementation(url, init));
    await render(); await type(editor(), "Русский черновик."); await click(button(L.prepare));
    expect(onSend).not.toHaveBeenCalled(); expect(host.textContent).toContain(L.statusFailed);
    await click(button(L.polishMode)); await type(editor(), "Dzień dobry."); await click(button(adminDicts.ru.chat.send));
    expect(onSend).toHaveBeenCalledWith("Dzień dobry.", [], null);
  });

  it("never switches a retained Russian draft to direct sending when a retry reports an unconfigured translator", async () => {
    status = { ...ready, enabled: false, reason: "limit_reached" };
    await render(); await type(editor(), "Этот русский текст нельзя отправить напрямую.");
    status = { ...ready, enabled: false, reason: "not_configured" };
    await click(button(L.retryStatus));
    expect(button(L.russianMode).getAttribute("aria-pressed")).toBe("true");
    expect(editor().value).toBe("Этот русский текст нельзя отправить напрямую.");
    await click(button(L.prepare));
    expect(onSend).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.filter(([url]) => String(url).endsWith("/translations"))).toHaveLength(0);
    expect(host.textContent).toContain(L.unavailable);
    await click(button(L.polishMode)); await type(editor(), "Tę polską wiadomość można wysłać.");
    await click(button(adminDicts.ru.chat.send));
    expect(onSend).toHaveBeenCalledWith("Tę polską wiadomość można wysłać.", [], null);
  });
});
