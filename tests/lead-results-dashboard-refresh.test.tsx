// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { LeadResultDetail, LeadResultsReport } from "@/config/lead-results";
import { ACTIVE_LEAD_STATUSES } from "@/config/content";
import { adminDicts } from "@/config/admin-i18n";

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

function statusCounts(overrides: Partial<LeadResultsReport["statuses"]> = {}): LeadResultsReport["statuses"] {
  return {
    new: 0, in_progress: 0, awaiting_data: 0, data_received: 0, signal_working: 0, rejected: 0,
    awaiting_reply: 0, suitable: 0, completed: 0, candidate_declined: 0, no_contact: 0,
    ...overrides,
  };
}

it.each([false, true])("shows each current status separately without inflating active counts from historical statuses (legacy=%s)", async withLegacy => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const statuses = statusCounts({ new: 11, in_progress: 7, awaiting_data: 5, data_received: 3, signal_working: 2, rejected: 1,
    ...(withLegacy ? { completed: 2, awaiting_reply: 1, no_contact: 1 } : {}),
  });
  const counts = { leads: withLegacy ? 33 : 29, reviewed: 3, suitable: 2, success: 2 };
  const report: LeadResultsReport = {
    range: { from: "2026-10-02", to: "2026-11-02", timezone: "Europe/Warsaw" }, generatedAt: "2026-11-02T10:00:00Z",
    filters: { source: "all", responsible: "all" },
    totals: { ...counts, unreviewed: counts.leads - 3, unsuitable: 1, closed: withLegacy ? 6 : 3, attributed: 0 },
    rates: { suitableOfReviewed: 2 / 3, successOfAll: 2 / counts.leads }, qualifications: { unreviewed: counts.leads - 3, suitable: 2, unsuitable: 1 }, statuses,
    // This legacy open bucket deliberately includes new + in progress + awaiting data.
    closures: { open: withLegacy ? 24 : 23, data_received: 3, signal_working: 2, not_suitable: 1, candidate_declined: 0, no_contact: withLegacy ? 1 : 0, completed: withLegacy ? 2 : 0 },
    daily: [], sources: [{ kind: "direct", source: null, medium: null, campaign: null, key: "direct", ...counts, statuses }],
    sourceOptions: [], responsibles: [], lossReasons: [{ reason: null, leads: withLegacy ? 2 : 1 }], responsibleAdmins: [],
    leads: { items: [], total: counts.leads, page: 1, pageSize: 25, pages: 2 },
  };
  mocks.api.mockReset(); mocks.api.mockResolvedValue(report);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<LeadResultsDashboard />));
    expect(host.textContent).toContain("Только главный администратор");
    const summary = host.querySelector(".lres-summary-grid")!;
    expect(summary.querySelector('[data-lead-status-metric="all"] .lres-metric-value dd')?.textContent).toBe(String(counts.leads));
    expect(summary.querySelector(".lres-hero-number")?.textContent).toBe("2");
    for (const status of ACTIVE_LEAD_STATUSES) {
      expect(summary.textContent).toContain(adminDicts.ru.ui.statuses[status]);
      if (status !== "signal_working") {
        expect(summary.querySelector(`[data-lead-status-metric="${status}"] .lres-metric-value dd`)?.textContent).toBe(String(statuses[status]));
      }
      expect(host.querySelector(`[data-lead-source-status="${status}"]`)?.textContent).toBe(String(statuses[status]));
    }
    expect(summary.textContent).not.toContain("Оценены");
    expect(summary.textContent).not.toContain("Ещё не оценены");
    const legacyCell = host.querySelector('[data-lead-source-status="legacy"]');
    if (withLegacy) {
      expect(legacyCell?.textContent).toBe("4");
      const sum = Array.from(host.querySelectorAll("[data-lead-source-status]"), cell => Number(cell.textContent)).reduce((a, b) => a + b, 0);
      expect(sum).toBe(counts.leads);
    } else {
      expect(legacyCell).toBeNull();
    }
    expect(Array.from(host.querySelectorAll(".lres-source-table thead th"), cell => cell.textContent)).toEqual([
      "Источник", "Лиды", ...ACTIVE_LEAD_STATUSES.map(status => adminDicts.ru.ui.statuses[status]),
      ...(withLegacy ? ["Сохранённые прежние статусы"] : []), "Успех / лиды",
    ]);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

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
  let report: LeadResultsReport = {
    range: { from: "2026-10-02", to: "2026-11-02", timezone: "Europe/Warsaw" }, generatedAt: "2026-11-02T10:00:00Z",
    filters: { source: "all", responsible: "all" }, totals: { leads: 1, reviewed: 0, suitable: 0, success: 0, unreviewed: 1, unsuitable: 0, closed: 0, attributed: 0 },
    rates: { suitableOfReviewed: null, successOfAll: 0 }, qualifications: { unreviewed: 1, suitable: 0, unsuitable: 0 },
    statuses: statusCounts({ new: 1 }),
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
    expect(host.querySelector('[data-lead-status-metric="new"] .lres-metric-value dd')?.textContent).toBe("1");
    expect(host.querySelector(".lres-hero-number")?.textContent).toBe("0");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lead-result-edit="12"]')!.click());
    await act(async () => {
      const field = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Private unsaved draft");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    detail = { ...detail, status: "signal_working", result: { ...detail.result, version: 1, comment: "Other tab" } };
    report = {
      ...report,
      totals: { ...report.totals, reviewed: 1, suitable: 1, success: 1, unreviewed: 0, closed: 1 },
      rates: { suitableOfReviewed: 1, successOfAll: 1 }, qualifications: { unreviewed: 0, suitable: 1, unsuitable: 0 },
      statuses: statusCounts({ signal_working: 1 }), closures: { ...report.closures, open: 0, signal_working: 1 },
      leads: { ...report.leads, items: [{ ...report.leads.items[0], status: "signal_working", result: detail.result, hasSavedResult: true }] },
    };
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector('[data-lead-status-metric="new"] .lres-metric-value dd')?.textContent).toBe("0");
    expect(host.querySelector(".lres-hero-number")?.textContent).toBe("1");
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
