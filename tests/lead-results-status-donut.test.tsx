// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeadOutcomeDonut } from "@/components/admin/LeadResultsCharts";
import { setAdminLang } from "@/components/admin/i18n";
import { STATUS_TONE } from "@/components/admin/ui";
import { ACTIVE_LEAD_STATUSES, LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { adminDicts, type AdminLang } from "@/config/admin-i18n";
import type { LeadResultsReport } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";

const counts = (values: Partial<Record<LeadStatus, number>> = {}): LeadResultsReport["statuses"] =>
  Object.assign(Object.fromEntries(LEAD_STATUSES.map(status => [status, 0])), values) as LeadResultsReport["statuses"];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(statuses: LeadResultsReport["statuses"], lang: AdminLang = "ru") {
  setAdminLang(lang);
  const total = Object.values(statuses).reduce((sum, value) => sum + value, 0);
  await act(async () => root.render(<LeadOutcomeDonut statuses={statuses} total={total} locale={adminDicts[lang].locale} labels={leadResultsCopy[lang]} />));
}

describe("lead status chart", () => {
  it.each<AdminLang>(["ru", "pl", "en"])("uses the lead list's six labels, order and colors in %s without grouping new leads as in progress", async lang => {
    const statuses = counts({ new: 12, in_progress: 3, awaiting_data: 4, data_received: 2, signal_working: 1, rejected: 2 });
    await render(statuses, lang);
    const rows = Array.from(host.querySelectorAll<HTMLLIElement>(".lres-status-legends > ul > li"));
    expect(rows.map(row => row.dataset.leadStatus)).toEqual(ACTIVE_LEAD_STATUSES);
    expect(rows.map(row => row.querySelector(".lres-outcome-name")?.textContent)).toEqual(ACTIVE_LEAD_STATUSES.map(status => adminDicts[lang].ui.statuses[status]));
    expect(rows.map(row => row.querySelector("strong")?.textContent)).toEqual(["12", "3", "4", "2", "1", "2"]);
    const percent = new Intl.NumberFormat(adminDicts[lang].locale, { style: "percent", maximumFractionDigits: 1 });
    for (const row of rows) {
      const status = row.dataset.leadStatus as LeadStatus;
      expect(row.querySelector(".lres-legend-mark")?.classList.contains(STATUS_TONE[status].dot)).toBe(true);
      expect(row.querySelector(".lres-outcome-percent")?.textContent).toBe(percent.format(statuses[status] / 24));
      expect(host.querySelector(`svg [data-lead-status="${status}"]`)?.getAttribute("stroke")).toBe(STATUS_TONE[status].color);
    }
    expect(host.querySelector(".lres-legacy-statuses")).toBeNull();
  });

  it("keeps nonzero historical statuses separate and included in the total, percentages and arcs", async () => {
    await render(counts({ new: 3, in_progress: 1, completed: 2, awaiting_reply: 2 }));
    expect(host.querySelector('.lres-status-legends > ul [data-lead-status="in_progress"] strong')?.textContent).toBe("1");
    const legacy = host.querySelector(".lres-legacy-statuses")!;
    expect(legacy.getAttribute("aria-label")).toBe(leadResultsCopy.ru.legacyStatuses);
    expect(Array.from(legacy.querySelectorAll("li"), row => row.getAttribute("data-lead-status"))).toEqual(["awaiting_reply", "completed"]);
    expect(legacy.textContent).toContain(adminDicts.ru.ui.statuses.awaiting_reply);
    expect(legacy.textContent).toContain(adminDicts.ru.ui.statuses.completed);
    expect(host.querySelector('.lres-donut > div > strong')?.textContent).toBe("8");
    expect(Array.from(host.querySelectorAll(".lres-status-legends li strong"), el => Number(el.textContent)).reduce((sum, value) => sum + value, 0)).toBe(8);
    expect(host.querySelector('li[data-lead-status="completed"] .lres-outcome-percent')?.textContent).toBe(new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }).format(2 / 8));
    expect(host.querySelectorAll(".lres-donut > svg [data-lead-status]")).toHaveLength(4);
    expect(host.querySelector('svg [data-lead-status="completed"]')?.getAttribute("stroke")).toBe(STATUS_TONE.completed.color);
    expect(host.textContent).not.toContain(adminDicts.ru.ui.statuses.no_contact);
  });

  it("renders all six empty statuses without imaginary slices or invalid percentages", async () => {
    await render(counts());
    const rows = Array.from(host.querySelectorAll(".lres-status-legends li"));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.querySelector("strong")?.textContent).toBe("0");
      expect(row.querySelector(".lres-outcome-percent")?.textContent).toBe("—");
    }
    expect(host.querySelectorAll("svg [data-lead-status]")).toHaveLength(0);
    expect(host.querySelector(".lres-legacy-statuses")).toBeNull();
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("draws one complete ring when every lead has one status", async () => {
    await render(counts({ awaiting_data: 7 }));
    const segments = host.querySelectorAll("svg [data-lead-status]");
    expect(segments).toHaveLength(1);
    expect(segments[0].tagName.toLowerCase()).toBe("circle");
    expect(segments[0].getAttribute("stroke")).toBe(STATUS_TONE.awaiting_data.color);
  });
});
