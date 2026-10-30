// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translationCopy, type IncomingTranslationResponse } from "@/config/chat-translation";
import type { ChatMessage } from "@/lib/api";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/admin/i18n", () => ({ useAdminI18n: () => ({ lang: "ru" }) }));
import { AdminTranslatedMessageList } from "@/components/admin/AdminTranslatedMessageList";
import { MessageList } from "@/components/chat/MessageList";

let root: Root;
let host: HTMLDivElement;
const enabled = { enabled: true, reason: null, usedUsd: 0.001, limitUsd: 5 };
const T = translationCopy.ru;
const message = (id = "visitor-1", body = "Dzień dobry", sender: ChatMessage["sender"] = "visitor"): ChatMessage => ({
  id, body, sender, sequence: id.replace(/\D/g, "") || "1", createdAt: "2026-10-30T10:00:00.000Z", clientMessageId: `client-${id}`,
  bodyRich: null, changeRevision: 0, files: [],
});
const response = (ids: string[], body = "Добрый день"): IncomingTranslationResponse => ({
  translations: ids.map(messageId => ({ messageId, sourceHash: `hash-${messageId}`, body })), failures: [],
});
const render = (messages = [message()], leadId = "1") => act(async () => root.render(<AdminTranslatedMessageList leadId={leadId} messages={messages} emptyText="No messages" />));
const translationCalls = () => mocks.api.mock.calls.filter(([url]) => String(url).endsWith("/translations"));
const click = (text: string) => act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocks.api.mockReset();
  mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[] } }) => url === "/api/admin/translation"
    ? Promise.resolve(enabled) : Promise.resolve(response(init?.json?.messageIds ?? [])));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("private incoming chat translations", () => {
  it("keeps the Polish original and adds a separate Russian translation only to visitor text", async () => {
    const fileOnly = { ...message("visitor-4", ""), files: [{ id: "pdf", name: "private.pdf", mime: "application/pdf", size: 12, url: "/api/files/pdf" }] };
    await render([message(), message("admin-2", "Dziękujemy", "admin"), message("system-3", "Received", "system"), fileOnly]);
    expect(translationCalls()).toHaveLength(1);
    expect(translationCalls()[0][1].json).toEqual({ kind: "incoming", messageIds: ["visitor-1"] });
    expect(host.textContent).toContain("Dzień dobry");
    expect(host.querySelectorAll("[data-admin-translation]")).toHaveLength(1);
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Добрый день");
    expect(host.textContent).toContain(T.incomingTitle);
  });

  it("does not translate the same content again on chat polling, but translates new messages", async () => {
    await render();
    await render([{ ...message() }]);
    expect(translationCalls()).toHaveLength(1);
    await render([message(), message("visitor-2", "Czy wszystko działa?")]);
    expect(translationCalls()).toHaveLength(2);
    expect(translationCalls()[1][1].json.messageIds).toEqual(["visitor-2"]);
  });

  it("batches loaded history without repeatedly requesting already translated messages", async () => {
    const history = Array.from({ length: 45 }, (_, index) => message(`visitor-${index + 1}`));
    await render(history);
    expect(translationCalls().map(([, init]) => init.json.messageIds.length)).toEqual([20, 20, 5]);
    await render(history.map(item => ({ ...item })));
    expect(translationCalls()).toHaveLength(3);
    expect(host.querySelectorAll('[lang="ru"]')).toHaveLength(45);
  });

  it("does not abort or repeat a paid request when another message arrives", async () => {
    const pending = deferred<IncomingTranslationResponse>();
    let oldSignal: AbortSignal | undefined;
    mocks.api.mockImplementation((url: string, init?: { signal?: AbortSignal; json?: { messageIds: string[] } }) => {
      if (url === "/api/admin/translation") return Promise.resolve(enabled);
      if (init?.json?.messageIds.includes("visitor-1")) { oldSignal = init.signal; return pending.promise; }
      return Promise.resolve(response(init?.json?.messageIds ?? [], "Новое сообщение"));
    });
    await render();
    await render([message(), message("visitor-2", "Nowa wiadomość")]);
    expect(translationCalls()).toHaveLength(2);
    expect(translationCalls().map(([, init]) => init.json.messageIds)).toEqual([["visitor-1"], ["visitor-2"]]);
    expect(oldSignal?.aborted).toBe(false);
    await act(async () => pending.resolve(response(["visitor-1"])));
    expect(host.textContent).toContain("Добрый день");
    expect(host.textContent).toContain("Новое сообщение");
  });

  it("ignores an old in-flight response after switching leads", async () => {
    const old = deferred<IncomingTranslationResponse>();
    mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[] } }) => url === "/api/admin/translation"
      ? Promise.resolve(enabled) : url.includes("/leads/1/") ? old.promise : Promise.resolve(response(init?.json?.messageIds ?? [], "Новый кандидат")));
    await render();
    await render([message("visitor-2", "Nowy kandydat")], "2");
    expect(host.textContent).toContain("Новый кандидат");
    await act(async () => old.resolve(response(["visitor-1"], "PRIVATE OLD LEAD")));
    expect(host.textContent).not.toContain("PRIVATE OLD LEAD");
    expect(host.textContent).not.toContain("Dzień dobry");
  });

  it("hides an outdated translation immediately after an edit and replaces it with the new result", async () => {
    await render();
    const edited = deferred<IncomingTranslationResponse>();
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled) : edited.promise);
    await render([{ ...message("visitor-1", "Zmieniona wiadomość"), changeRevision: 1 }]);
    expect(host.textContent).toContain("Zmieniona wiadomość");
    expect(host.textContent).not.toContain("Добрый день");
    expect(host.textContent).toContain(T.incomingLoading);
    await act(async () => edited.resolve(response(["visitor-1"], "Изменённое сообщение")));
    expect(host.textContent).toContain("Изменённое сообщение");
  });

  it("does not reintroduce deleted messages when their translation arrives late", async () => {
    const pending = deferred<IncomingTranslationResponse>();
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled) : pending.promise);
    await render();
    await render([]);
    await act(async () => pending.resolve(response(["visitor-1"], "Deleted private text")));
    expect(host.textContent).toBe("No messages");
    expect(host.querySelector("[data-admin-translation]")).toBeNull();
  });

  it("keeps failures stable during polling and retries only when requested", async () => {
    let failed = true;
    mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[] } }) => url === "/api/admin/translation"
      ? Promise.resolve(enabled) : Promise.resolve(failed
        ? { translations: [], failures: [{ messageId: "visitor-1", code: "translation_failed" }] }
        : response(init?.json?.messageIds ?? [])));
    await render();
    expect(host.textContent).toContain(T.incomingFailed);
    await render([{ ...message() }]);
    expect(translationCalls()).toHaveLength(1);
    failed = false;
    await click(T.incomingRetry);
    expect(translationCalls()).toHaveLength(2);
    expect(host.textContent).toContain("Добрый день");
  });

  it("stops the remaining history batches when the translator becomes unconfigured", async () => {
    mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[] } }) => url === "/api/admin/translation"
      ? Promise.resolve(enabled) : Promise.resolve({ translations: [], failures: (init?.json?.messageIds ?? []).map(messageId => ({ messageId, code: "translation_not_configured" })) }));
    const history = Array.from({ length: 45 }, (_, index) => message(`visitor-${index + 1}`));
    await render(history);
    expect(translationCalls()).toHaveLength(1);
    expect(host.textContent).toContain(T.incomingUnavailable);
    await render(history.map(item => ({ ...item })));
    expect(translationCalls()).toHaveLength(1);
  });

  it("switches to cache-only reads when the budget is reached while loading history", async () => {
    mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[]; cacheOnly?: boolean } }) => {
      if (url === "/api/admin/translation") return Promise.resolve(enabled);
      const ids = init?.json?.messageIds ?? [];
      return Promise.resolve({
        translations: init?.json?.cacheOnly && ids.includes("visitor-45")
          ? [{ messageId: "visitor-45", sourceHash: "saved-hash", body: "Уже оплаченный перевод" }] : [],
        failures: ids.filter(id => id !== "visitor-45" || !init?.json?.cacheOnly)
          .map(messageId => ({ messageId, code: "translation_limit_reached" })),
      });
    });
    const history = Array.from({ length: 45 }, (_, index) => message(`visitor-${index + 1}`));
    await render(history);
    expect(translationCalls().map(([, init]) => init.json.messageIds.length)).toEqual([20, 20, 5]);
    expect(translationCalls().map(([, init]) => init.json.cacheOnly === true)).toEqual([false, true, true]);
    expect(host.textContent).toContain("Уже оплаченный перевод");
    expect(host.textContent).toContain(T.incomingLimit);
    await render(history.map(item => ({ ...item })));
    expect(translationCalls()).toHaveLength(3);
    await render([...history, message("visitor-46", "Nowa wiadomość")]);
    expect(translationCalls()).toHaveLength(4);
    expect(translationCalls()[3][1].json).toEqual({ kind: "incoming", messageIds: ["visitor-46"], cacheOnly: true });
  });

  it("does not request translation when not configured", async () => {
    mocks.api.mockResolvedValue({ ...enabled, enabled: false, reason: "not_configured" });
    await render();
    expect(translationCalls()).toHaveLength(0);
    expect(host.textContent).toContain("Dzień dobry");
    expect(host.querySelector("[data-admin-translation]")).toBeNull();
  });

  it("loads saved translations across all history batches at the limit, using cache-only requests", async () => {
    mocks.api.mockImplementation((url: string, init?: { json?: { messageIds: string[]; cacheOnly?: boolean } }) => {
      if (url === "/api/admin/translation") return Promise.resolve({ ...enabled, enabled: false, reason: "limit_reached" });
      const ids = init?.json?.messageIds ?? [];
      return Promise.resolve({
        translations: ids.includes("visitor-45") ? [{ messageId: "visitor-45", sourceHash: "saved-hash", body: "Сохранённый перевод" }] : [],
        failures: ids.filter(id => id !== "visitor-45").map(messageId => ({ messageId, code: "translation_limit_reached" })),
      });
    });
    const history = Array.from({ length: 45 }, (_, index) => message(`visitor-${index + 1}`));
    await render(history);
    expect(translationCalls().map(([, init]) => init.json.messageIds.length)).toEqual([20, 20, 5]);
    expect(translationCalls().every(([, init]) => init.json.cacheOnly === true)).toBe(true);
    expect(host.textContent).toContain("Сохранённый перевод");
    expect(host.textContent).toContain(T.incomingLimit);
    await render(history.map(item => ({ ...item })));
    expect(translationCalls()).toHaveLength(3);
  });

  it("never invokes a private message extension in a visitor feed", async () => {
    const extension = vi.fn(() => <p>PRIVATE ADMIN TEXT</p>);
    await act(async () => root.render(<MessageList messages={[message()]} viewer="visitor" appearance="visitor" emptyText="Empty" messageExtension={extension} />));
    expect(extension).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("PRIVATE ADMIN TEXT");
    await act(async () => root.render(<MessageList messages={[message("admin-1", "Admin", "admin"), message("system-2", "System", "system")]} viewer="admin" appearance="admin" emptyText="Empty" messageExtension={extension} />));
    expect(extension).not.toHaveBeenCalled();
  });
});
