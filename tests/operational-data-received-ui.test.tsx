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

describe("received-data status controls", () => {
  it.each<[AdminLang, string]>([["ru", "Получили данные"], ["pl", "Otrzymano dane"], ["en", "Data received"]])("offers and selects the handling status in %s list controls", async (lang, label) => {
    const changed = vi.fn();
    await act(async () => { setAdminLang(lang); root.render(<>
      <StatusSelect value="data_received" onChange={changed} label="Lead status" />
      <StatusFilter value="data_received" onChange={changed} label="Status filter" allLabel="All" />
      <StatusBadge status="data_received" />
    </>); });
    const selects = [...host.querySelectorAll<HTMLSelectElement>("select")];
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select.value).toBe("data_received");
      expect(select.selectedOptions[0].textContent).toBe(label);
      expect(select.parentElement?.className).toContain("text-adm-teal");
      await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
    }
    expect(changed).toHaveBeenCalledWith("data_received");
    expect(host.querySelector(".adm-badge")?.textContent).toBe(label);
    expect(host.querySelector(".adm-badge")?.className).toContain("text-adm-teal");
    expect(NEXT_STATUS.awaiting_reply).toBe("data_received");
    expect(NEXT_STATUS.data_received).toBe("completed");
  });
});
