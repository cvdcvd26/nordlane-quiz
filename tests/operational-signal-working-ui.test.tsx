// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusBadge, StatusFilter, StatusSelect, NEXT_STATUS } from "@/components/admin/ui";
import { setAdminLang } from "@/components/admin/i18n";
import type { AdminLang } from "@/config/admin-i18n";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Signal success status controls", () => {
  it.each<[AdminLang, string]>([
    ["ru", "🎉 Перевели в Signal / Работаем"],
    ["pl", "🎉 Przeniesiono do Signal / Współpracujemy"],
    ["en", "🎉 Moved to Signal / Working together"],
  ])("offers a distinct emerald success status and filter in %s", async (lang, label) => {
    const changed = vi.fn();
    await act(async () => { setAdminLang(lang); root.render(<>
      <StatusSelect value="signal_working" onChange={changed} label="Lead status" />
      <StatusFilter value="signal_working" onChange={changed} label="Status filter" allLabel="All" />
      <StatusBadge status="signal_working" />
    </>); });
    const selects = [...host.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.value).toBe("signal_working");
      expect(select.selectedOptions[0].textContent).toBe(label);
      expect(select.parentElement?.className).toContain("text-adm-accent");
      expect(select.querySelector('option[value="completed"]')).not.toBeNull();
      await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
    }
    expect(changed).toHaveBeenCalledWith("signal_working");
    expect(host.querySelector(".adm-badge")?.textContent).toBe(label);
    expect(host.querySelector(".adm-badge")?.className).toContain("text-adm-accent");
    expect(NEXT_STATUS.signal_working).toBeUndefined();
    expect(NEXT_STATUS.data_received).toBe("completed");
  });
});
