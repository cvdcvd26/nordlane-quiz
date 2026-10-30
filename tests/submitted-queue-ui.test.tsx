// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAdminLang } from "@/components/admin/i18n";
import { workflowCopy } from "@/config/admin-workflow";
import type { AdminLang } from "@/config/admin-i18n";
import { formatTime } from "@/lib/api";

const mocks = vi.hoisted(() => ({ params: "", api: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.params) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/admin/toast", () => ({ toast: vi.fn() }));

import LeadsPage from "@/app/admin/(panel)/page";
import LeadInboxSidebar from "@/components/admin/LeadInboxSidebar";

let host: HTMLDivElement;
let root: Root;
const submittedAt = "2026-10-29T12:34:00.000Z";
const createdAt = "2025-01-01T00:00:00.000Z";
const lastQuery = () => new URL(mocks.api.mock.calls.at(-1)![0] as string, "https://example.com").searchParams;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  mocks.params = "";
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (url: string) => {
    const params = new URL(url, "https://example.com").searchParams;
    const page = Number(params.get("page") ?? 1);
    const pageSize = Number(params.get("pageSize") ?? 5);
    const total = 26;
    return { page, pageSize, total, submittedCount: 37, needsReplyCount: 2, unfinishedCount: 3,
      items: Array.from({ length: Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize)) }, (_, index) => ({
        id: (page - 1) * pageSize + index + 1, contactName: `Anna ${index + 1}`, contactPhone: "+48600123456",
        manager: { id: "maja", name: "Maja (HR)", avatar: "/maja-hr.png" }, status: "data_received",
        stage: "submitted", answered: 3, answer: "yes,yes,no", submittedAt, createdAt, lastSeenAt: submittedAt,
        lastMessageAt: null, messageCount: 0, needsReply: false, isUnfinished: false,
        replyWaitingSince: null, lastVisitorMessage: null, isActive: false,
      })) };
  });
  window.history.replaceState(null, "", "/admin");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  setAdminLang("ru");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("submitted task lead queue", () => {
  it("opens the separate queue, retains search/status, resets unfinished filters and paginates by submission time", async () => {
    mocks.params = "queue=unfinished&q=Anna&status=data_received&stage=task&inactiveMinutes=120&page=2";
    await act(async () => root.render(<LeadsPage />));
    const tab = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
      .find(button => button.textContent?.startsWith("Выполнили задание"))!;
    expect(tab.textContent).toBe("Выполнили задание37");
    await act(async () => tab.click());
    const selected = lastQuery();
    expect(selected.get("queue")).toBe("submitted");
    expect(selected.get("q")).toBe("Anna");
    expect(selected.get("status")).toBe("data_received");
    expect(selected.has("page")).toBe(false);
    expect(selected.has("stage")).toBe(false);
    expect(selected.has("inactiveMinutes")).toBe(false);
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain(workflowCopy.ru.submittedHint);
    expect(host.querySelector("thead th:last-child")?.textContent).toBe("Задание отправлено");
    const dateCell = host.querySelector("tbody tr td:last-child")!;
    expect(dateCell.textContent).toBe(formatTime(submittedAt, "ru-RU"));
    expect(dateCell.textContent).not.toBe(formatTime(createdAt, "ru-RU"));
    const sort = host.querySelector<HTMLSelectElement>("#sort")!;
    expect(sort.disabled).toBe(false);
    expect(sort.selectedOptions[0].textContent).toBe("Сначала новые задания");
    await act(async () => { sort.value = "asc"; sort.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(lastQuery().get("sort")).toBe("asc");
    const next = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Вперёд")!;
    await act(async () => next.click());
    expect(lastQuery().get("page")).toBe("2");
    expect(lastQuery().get("queue")).toBe("submitted");
    expect(lastQuery().get("sort")).toBe("asc");
    const link = host.querySelector<HTMLAnchorElement>('tbody a[href^="/admin/leads/"]')!;
    const context = new URL(link.href).searchParams;
    expect(context.get("queue")).toBe("submitted");
    expect(context.get("status")).toBe("data_received");
    expect(context.get("q")).toBe("Anna");
    expect(context.get("page")).toBe("2");
    expect(tab.textContent).toBe("Выполнили задание37");
  });

  it.each<[AdminLang, string]>([["ru", "Выполнили задание"], ["pl", "Wysłali zadanie"], ["en", "Submitted task"]])("restores a direct submitted URL and shows the queue's empty state in %s", async (lang, label) => {
    mocks.params = "queue=submitted";
    mocks.api.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0, submittedCount: 0, needsReplyCount: 0, unfinishedCount: 0 });
    setAdminLang(lang);
    await act(async () => root.render(<LeadsPage />));
    const tab = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(button => button.textContent?.startsWith(label))!;
    expect(tab.getAttribute("aria-pressed")).toBe("true");
    expect(tab.textContent).toBe(`${label}0`);
    expect(lastQuery().get("queue")).toBe("submitted");
    expect(host.textContent).toContain(workflowCopy[lang].submittedEmpty);
  });

  it("preserves the submitted queue and filter context inside the lead workspace sidebar", async () => {
    mocks.params = "queue=submitted&q=Anna&status=data_received&sort=asc&page=2";
    await act(async () => root.render(<LeadInboxSidebar selectedId="21" />));
    const selectors = [...host.querySelectorAll<HTMLSelectElement>("select")];
    expect(selectors.every(select => select.value === "submitted")).toBe(true);
    expect(selectors[0].selectedOptions[0].textContent).toBe("Выполнили задание");
    const query = lastQuery();
    for (const [key, value] of Object.entries({ queue: "submitted", q: "Anna", status: "data_received", sort: "asc", page: "2" })) expect(query.get(key)).toBe(value);
    const link = host.querySelector<HTMLAnchorElement>('nav a[href^="/admin/leads/"]')!;
    const context = new URL(link.href).searchParams;
    for (const key of ["queue", "q", "status", "sort", "page"]) expect(context.get(key)).toBe(query.get(key));
    await act(async () => { selectors[0].value = "all"; selectors[0].dispatchEvent(new Event("change", { bubbles: true })); });
    expect(lastQuery().get("queue")).toBe("all");
    expect(lastQuery().get("page")).toBe("1");
  });
});
