import { describe, expect, it, vi } from "vitest";
import { createAdminDraftRegistry, shouldGuardAdminDraftLink } from "@/lib/admin-draft-guard";

describe("administrator draft navigation guard", () => {
  it("combines chat, note, reminder and revision owners without letting one clear another", () => {
    const registry = createAdminDraftRegistry();
    const chat = registry.register("lead:42");
    const note = registry.register("lead:42");
    const reminder = registry.register("lead:42");
    const revision = registry.register("lead:42");
    expect(registry.hasDirty()).toBe(false);
    chat.setDirty(true); reminder.setDirty(true); revision.setDirty(true);
    chat.setDirty(false); note.dispose();
    expect(registry.hasDirty("lead:42")).toBe(true);
    reminder.dispose();
    expect(registry.hasDirty()).toBe(true);
    revision.setDirty(false);
    expect(registry.hasDirty()).toBe(false);
    chat.dispose(); revision.dispose();
  });

  it("cleans up unmounted scopes and ignores delayed updates from disposed owners", () => {
    const registry = createAdminDraftRegistry();
    const previous = registry.register("lead:42");
    const current = registry.register("lead:99");
    previous.setDirty(true); current.setDirty(true);
    expect(registry.hasDirty("lead:42")).toBe(true);
    previous.dispose(); previous.dispose(); previous.setDirty(true);
    expect(registry.hasDirty("lead:42")).toBe(false);
    expect(registry.hasDirty("lead:99")).toBe(true);
    current.dispose();
    expect(registry.hasDirty()).toBe(false);
  });

  it("asks once for a click shared by document capture and a React sidebar handler", () => {
    const registry = createAdminDraftRegistry();
    const source = registry.register("lead:42");
    const ask = vi.fn(() => true);
    const nativeEvent = {};
    expect(registry.confirm("Leave?", nativeEvent, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    source.setDirty(true);
    expect(registry.confirm("Leave?", nativeEvent, ask)).toBe(true);
    expect(registry.confirm("Leave?", { nativeEvent }, ask)).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
    const reject = vi.fn(() => false);
    const nextClick = {};
    expect(registry.confirm("Leave?", nextClick, reject)).toBe(false);
    expect(registry.confirm("Leave?", { nativeEvent: nextClick }, ask)).toBe(false);
    expect(reject).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledOnce();
    source.dispose();
  });

  it("guards same-tab internal page changes while allowing new tabs, downloads and same-page links", () => {
    const base = { href: "/admin/leads/99", currentUrl: "https://example.com/admin/leads/42?queue=all" };
    expect(shouldGuardAdminDraftLink(base)).toBe(true);
    expect(shouldGuardAdminDraftLink({ ...base, href: "/admin/settings" })).toBe(true);
    for (const change of [
      { href: "#lead-reminders" }, { href: "/admin/leads/42?queue=needs_reply" },
      { href: "https://other.example/admin" }, { href: "mailto:staff@example.com" },
      { target: "_blank" }, { target: "named-window" }, { download: true }, { button: 1 },
      { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true },
    ]) expect(shouldGuardAdminDraftLink({ ...base, ...change })).toBe(false);
  });
});
