// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translationCopy } from "@/config/chat-translation";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/admin/i18n", () => ({ useAdminI18n: () => ({ lang: "ru" }) }));
import { ApiError } from "@/lib/api";
import { AdminTaskTranslation, AdminTaskTranslationProvider } from "@/components/admin/AdminTaskTranslation";

let root: Root;
let host: HTMLDivElement;
const enabled = { enabled: true, reason: null, usedUsd: 0.001, limitUsd: 5 };
const T = translationCopy.ru;
type Item = { leadId: number; sourceId: string; body: string; kind?: "task_review" | "incoming" };
const item = (sourceId = "submission-1", body = "Wszystko działa", leadId = 1): Item => ({ leadId, sourceId, body });
const translated = (body = "Всё работает") => ({ body, sourceHash: "source-hash" });
const requests = () => mocks.api.mock.calls.filter(([url]) => String(url).endsWith("/translations"));
const statuses = () => mocks.api.mock.calls.filter(([url]) => url === "/api/admin/translation");
const render = (items = [item()], scopeKey = "screen") => act(async () => root.render(
  <AdminTaskTranslationProvider key={scopeKey}>{items.map(source => <article key={source.sourceId}>
    <p>{source.body}</p><AdminTaskTranslation {...source} />
  </article>)}</AdminTaskTranslationProvider>,
));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mocks.api.mockReset();
  mocks.api.mockImplementation((url: string) => Promise.resolve(url === "/api/admin/translation" ? enabled : translated()));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Russian translations of task comments", () => {
  it("keeps the original and requests only the submission identifier, without re-translating polled copies", async () => {
    await render();
    expect(host.textContent).toContain("Wszystko działa");
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Всё работает");
    expect(host.textContent).toContain(T.incomingTitle);
    expect(requests()[0][0]).toBe("/api/admin/leads/1/translations");
    expect(requests()[0][1].json).toEqual({ kind: "task_review", submissionId: "submission-1" });
    await render([{ ...item() }]);
    expect(requests()).toHaveLength(1);
    expect(statuses()).toHaveLength(1);
  });

  it("shares availability and processes a list sequentially instead of starting paid requests together", async () => {
    const pending = Array.from({ length: 4 }, () => deferred<ReturnType<typeof translated>>());
    let index = 0;
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled) : pending[index++].promise);
    await render(pending.map((_, n) => item(`submission-${n}`)));
    expect(statuses()).toHaveLength(1);
    expect(requests()).toHaveLength(1);
    for (let n = 0; n < pending.length; n++) {
      await act(async () => pending[n].resolve(translated(`Перевод ${n}`)));
      expect(requests()).toHaveLength(Math.min(n + 2, pending.length));
    }
    expect(host.querySelectorAll('[lang="ru"]')).toHaveLength(4);
  });

  it("does not translate whitespace or files-only responses", async () => {
    await render([item("blank", " \n ")]);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(host.querySelector("[data-admin-task-translation]")).toBeNull();
  });

  it("uses the existing message cache for revision responses", async () => {
    mocks.api.mockImplementation((url: string) => Promise.resolve(url === "/api/admin/translation" ? enabled : {
      translations: [{ messageId: "response-message-1", ...translated("Исправлено") }], failures: [],
    }));
    await render([{ ...item("response-message-1", "Poprawione"), kind: "incoming" }]);
    expect(requests()[0][1].json).toEqual({ kind: "incoming", messageIds: ["response-message-1"] });
    expect(host.textContent).toContain("Poprawione");
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Исправлено");
  });

  it("discards old lead results and cancels queued work when the screen changes", async () => {
    const previous = deferred<ReturnType<typeof translated>>();
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled)
      : url.includes("/leads/1/") ? previous.promise : Promise.resolve(translated("Новый кандидат")));
    await render([item(), item("submission-queued")], "lead-1");
    const firstSignal = requests()[0][1].signal;
    await render([item("submission-new", "Nowy kandydat", 2)], "lead-2");
    expect(firstSignal.aborted).toBe(true);
    expect(host.textContent).toContain("Новый кандидат");
    await act(async () => previous.resolve(translated("PRIVATE OLD TEXT")));
    expect(host.textContent).not.toContain("PRIVATE OLD TEXT");
    expect(requests().some(([, init]) => init.json.submissionId === "submission-queued")).toBe(false);
    expect(statuses()).toHaveLength(2);
  });

  it("immediately hides an obsolete translation when source text changes", async () => {
    await render();
    const changed = deferred<ReturnType<typeof translated>>();
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled) : changed.promise);
    await render([item("submission-1", "Zmieniony komentarz")]);
    expect(host.textContent).not.toContain("Всё работает");
    expect(host.textContent).toContain(T.incomingLoading);
    await act(async () => changed.resolve(translated("Изменённый комментарий")));
    expect(host.textContent).toContain("Изменённый комментарий");
  });

  it("keeps failures stable during polling and retries only after an explicit click", async () => {
    let failed = true;
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled)
      : failed ? Promise.reject(new ApiError("Failed", 503, "translation_failed")) : Promise.resolve(translated()));
    await render();
    expect(host.textContent).toContain(T.incomingFailed);
    await render([{ ...item() }]);
    expect(requests()).toHaveLength(1);
    failed = false;
    await act(async () => host.querySelector("button")!.click());
    expect(requests()).toHaveLength(2);
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Всё работает");
  });

  it("does not send task text when the translator is unconfigured", async () => {
    mocks.api.mockResolvedValue({ ...enabled, enabled: false, reason: "not_configured" });
    await render([item(), item("submission-2")]);
    expect(statuses()).toHaveLength(1);
    expect(requests()).toHaveLength(0);
    expect(host.textContent).toContain("Wszystko działa");
    expect(host.querySelector("[data-admin-task-translation]")).toBeNull();
  });

  it("reads cached translations at the limit and switches remaining work to cache-only when the cap is reached", async () => {
    let count = 0;
    mocks.api.mockImplementation((url: string) => {
      if (url === "/api/admin/translation") return Promise.resolve(enabled);
      return ++count === 1 ? Promise.reject(new ApiError("Limit", 429, "translation_limit_reached")) : Promise.resolve(translated("Сохранённый перевод"));
    });
    await render([item(), item("submission-2")]);
    expect(requests().map(([, init]) => init.json.cacheOnly === true)).toEqual([false, true]);
    expect(host.textContent).toContain(T.incomingLimit);
    expect(host.textContent).toContain("Сохранённый перевод");
    mocks.api.mockImplementation((url: string) => Promise.resolve(url === "/api/admin/translation" ? { ...enabled, enabled: false, reason: "limit_reached" } : translated()));
    await render([item()], "new-screen");
    expect(requests().at(-1)![1].json.cacheOnly).toBe(true);
  });

  it("survives Strict Mode's effect cleanup without leaving translations stuck", async () => {
    await act(async () => root.render(<StrictMode><AdminTaskTranslationProvider>
      <AdminTaskTranslation {...item()} />
    </AdminTaskTranslationProvider></StrictMode>));
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Всё работает");
    expect(requests()).toHaveLength(1);
  });

  it("waits only on cache when another pane is translating, without confusing a cache miss with the budget cap", async () => {
    vi.useFakeTimers();
    let call = 0;
    mocks.api.mockImplementation((url: string) => {
      if (url === "/api/admin/translation") return Promise.resolve(enabled);
      call++;
      if (call === 1) return Promise.reject(new ApiError("Busy", 409, "translation_busy"));
      if (call === 2) return Promise.reject(new ApiError("Not ready", 429, "translation_limit_reached"));
      return Promise.resolve(translated());
    });
    await render();
    expect(host.textContent).toContain(T.incomingLoading);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.textContent).not.toContain(T.incomingLimit);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Всё работает");
    expect(requests().map(([, init]) => init.json.cacheOnly === true)).toEqual([false, true, true]);
    await render([item(), item("submission-2")]);
    expect(requests().at(-1)![1].json.cacheOnly).toBeUndefined();
  });

  it("bounds cache polling after contention and leaves a manual retry instead of starting paid retries", async () => {
    vi.useFakeTimers();
    mocks.api.mockImplementation((url: string, init?: { json?: { cacheOnly?: boolean } }) => url === "/api/admin/translation" ? Promise.resolve(enabled)
      : Promise.reject(new ApiError("Not ready", 409, init?.json?.cacheOnly ? "translation_limit_reached" : "translation_busy")));
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(23000));
    expect(requests()).toHaveLength(6);
    expect(requests().filter(([, init]) => !init.json.cacheOnly)).toHaveLength(1);
    expect(host.textContent).toContain(T.incomingFailed);
    await act(async () => vi.advanceTimersByTimeAsync(60000));
    expect(requests()).toHaveLength(6);
    mocks.api.mockImplementation((url: string) => Promise.resolve(url === "/api/admin/translation" ? enabled : translated()));
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[lang="ru"]')?.textContent).toBe("Всё работает");
  });

  it("cancels a delayed cache read when the source disappears", async () => {
    vi.useFakeTimers();
    mocks.api.mockImplementation((url: string) => url === "/api/admin/translation" ? Promise.resolve(enabled)
      : Promise.reject(new ApiError("Busy", 409, "translation_busy")));
    await render();
    await render([]);
    await act(async () => vi.advanceTimersByTimeAsync(23000));
    expect(requests()).toHaveLength(1);
    expect(host.querySelector("[data-admin-task-translation]")).toBeNull();
  });
});
