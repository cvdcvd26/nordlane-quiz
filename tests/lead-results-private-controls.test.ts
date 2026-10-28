import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/i18n", () => ({ useAdminI18n: () => ({ lang: "ru" }) }));
vi.mock("@/components/admin/LeadResultEditor", () => ({ default: () => createElement("div", null, "private editor") }));

import OwnerLeadResultPanel from "@/components/admin/OwnerLeadResultPanel";
import { OwnerAdminContext } from "@/components/admin/owner-access";

describe("private lead result controls", () => {
  it("renders no block before an owner capability is established", () => {
    expect(renderToStaticMarkup(createElement(OwnerLeadResultPanel, { leadId: "1" }))).toBe("");
  });
  it("renders no block or editor for an additional administrator", () => {
    expect(renderToStaticMarkup(createElement(OwnerAdminContext.Provider, { value: false }, createElement(OwnerLeadResultPanel, { leadId: "1" })))).toBe("");
  });
  it("renders the collapsed owner control without mounting its private editor", () => {
    const markup = renderToStaticMarkup(createElement(OwnerAdminContext.Provider, { value: true }, createElement(OwnerLeadResultPanel, { leadId: "1" })));
    expect(markup).toContain("Результат по лиду");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain("private editor");
  });
});
