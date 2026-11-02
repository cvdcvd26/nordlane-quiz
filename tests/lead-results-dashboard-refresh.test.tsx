// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { LeadResultDetail, LeadResultsReport } from "@/config/lead-results";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/admin/i18n", async () => {
  const { adminDicts } = await import("@/config/admin-i18n");
  return { useAdminI18n: () => ({ lang: "ru", t: adminDicts.ru }) };
});
vi.mock("@/components/admin/LeadResultsCharts", () => ({ DailyResultChart: () => null, LeadOutcomeDonut: () => null }));
import LeadResultsDashboard from "@/components/admin/LeadResultsDashboard";
import { ApiError } from "@/lib/api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("refreshes an open notes dialog without losing its draft and removes private data after access is revoked", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  const source = { kind: "direct", source: null, medium: null, campaign: null } as const;
  let detail: LeadResultDetail = { leadId: 12, status: "new", hasSavedResult: false, history: [], responsibleAdmins: [], result: {
    qualification: "unreviewed", closure: "open", reason: null, comment: "", responsibleAdminId: null,
    updatedById: null, version: 0, updatedAt: null, closedAt: null,
  } };
  const report: LeadResultsReport = {
    range: { from: "2026-10-02", to: "2026-11-02", timezone: "Europe/Warsaw" }, generatedAt: "2026-11-02T10:00:00Z",
    filters: { source: "all", responsible: "all" }, totals: { leads: 1, reviewed: 0, suitable: 0, success: 0, unreviewed: 1, unsuitable: 0, closed: 0, attributed: 0 },
    rates: { suitableOfReviewed: null, successOfAll: 0 }, qualifications: { unreviewed: 1, suitable: 0, unsuitable: 0 },
    closures: { open: 1, data_received: 0, signal_working: 0, not_suitable: 0, candidate_declined: 0, no_contact: 0, completed: 0 },
    daily: [], sources: [], sourceOptions: [], responsibles: [], lossReasons: [], responsibleAdmins: [],
    leads: { items: [{ id: 12, name: "Private Candidate", phone: "123456789", status: "new", createdAt: "2026-11-02T10:00:00Z", result: detail.result, hasSavedResult: false, source, responsible: null }], total: 1, page: 1, pageSize: 25, pages: 1 },
  };
  let forbidden = false;
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (url: string) => {
    if (forbidden) throw new ApiError("Forbidden", 403);
    return url.startsWith("/api/admin/lead-results?") ? report : detail;
  });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LeadResultsDashboard />));
    expect(host.textContent).toContain("Private Candidate");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lead-result-edit="12"]')!.click());
    await act(async () => {
      const field = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Private unsaved draft");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    detail = { ...detail, status: "signal_working", result: { ...detail.result, version: 1, comment: "Other tab" } };
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector("dialog")!.textContent).toContain("🎉 Перевели в Signal / Работаем");
    expect(host.querySelector("textarea")!.value).toBe("Private unsaved draft");
    expect(host.querySelector('a[href="/admin/leads/12"]')).not.toBeNull();
    forbidden = true; now += 1000;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector(".lres-report")).toBeNull();
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.textContent).not.toContain("Private Candidate");
    expect(host.textContent).not.toContain("Private unsaved draft");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
