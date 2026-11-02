// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadStatus } from "@/config/content";
import type { LeadResultDetail } from "@/config/lead-results";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/admin/i18n", async () => {
  const { adminDicts } = await import("@/config/admin-i18n");
  return { useAdminI18n: () => ({ lang: "ru", t: adminDicts.ru }) };
});
import LeadResultEditor from "@/components/admin/LeadResultEditor";
import { ApiError } from "@/lib/api";

let host: HTMLDivElement;
let root: Root;
let detail: LeadResultDetail;
const render = (currentStatus?: LeadStatus) => act(async () => root.render(<LeadResultEditor leadId="12" currentStatus={currentStatus} />));
const save = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
async function type(value: string) {
  await act(async () => {
    const field = host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  detail = { leadId: 12, status: "new", hasSavedResult: false, history: [], responsibleAdmins: [], result: {
    qualification: "unreviewed", closure: "open", reason: null, comment: "", responsibleAdminId: null,
    updatedById: null, version: 0, updatedAt: null, closedAt: null,
  } };
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (_url: string, options?: { method?: string; json?: { comment: string } }) => {
    if (options?.method === "PATCH") return { ...detail, hasSavedResult: true, result: { ...detail.result, comment: options.json!.comment, version: 1 } };
    return detail;
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("shared status and private metadata editor", () => {
  it("shows the actual lead status without a second selector and saves only private metadata", async () => {
    detail.status = "signal_working";
    await render();
    expect(host.textContent).toContain("🎉 Перевели в Signal / Работаем");
    expect(host.textContent).toContain("Статус лида уже учитывается в статистике");
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(host.querySelector('a[href="/admin/leads/12"]')).not.toBeNull();
    expect([...host.querySelectorAll("select option")].some(option => option.getAttribute("value") === "signal_working")).toBe(false);
    await type("Follow up tomorrow"); await save();
    expect(mocks.api).toHaveBeenLastCalledWith("/api/admin/leads/12/result", expect.objectContaining({
      method: "PATCH", json: { expectedVersion: 0, reason: null, comment: "Follow up tomorrow", responsibleAdminId: null },
    }));
  });

  it("updates the status after a card edit while protecting an unsaved draft from concurrent metadata changes", async () => {
    await render("new"); await type("My unsaved note");
    detail = { ...detail, status: "signal_working", result: { ...detail.result, version: 1, comment: "A different tab's note" } };
    await render("signal_working");
    expect(host.textContent).toContain("🎉 Перевели в Signal / Работаем");
    expect(host.querySelector("textarea")!.value).toBe("My unsaved note");
    mocks.api.mockRejectedValueOnce(new ApiError("Conflict", 409));
    await save();
    expect(mocks.api).toHaveBeenLastCalledWith("/api/admin/leads/12/result", expect.objectContaining({ json: expect.objectContaining({ expectedVersion: 0, comment: "My unsaved note" }) }));
    expect(host.querySelector("textarea")!.value).toBe("My unsaved note");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Результат уже изменён");
  });

  it("renders new status audit snapshots and retains older qualification snapshots", async () => {
    const legacy = { ...detail.result };
    detail.history = [{ id: "audit-1", previous: legacy, next: { ...legacy, status: "no_contact", closure: "no_contact" }, actor: null, createdAt: "2026-11-02T10:00:00Z" }];
    await render();
    expect(host.textContent).toContain("Нет контакта");
    expect(host.textContent).toContain("Не оценён");
  });
});
