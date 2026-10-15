import { describe, it, expect } from "vitest";
import { adminDicts, translateServerMessage } from "@/config/admin-i18n";
import { content } from "@/config/content";

describe("admin languages", () => {
  it("translates server error messages into the panel language", () => {
    expect(translateServerMessage(content.admin.login.invalid, "ru")).toBe("Неверный e-mail или пароль.");
    expect(translateServerMessage(content.admin.login.invalid, "en")).toBe("Wrong email or password.");
    expect(translateServerMessage(content.errors.rateLimited, "en")).toBe(adminDicts.en.errors.rateLimited);
    expect(translateServerMessage(content.admin.lead.noteEmpty, "pl")).toBe(content.admin.lead.noteEmpty);
    expect(translateServerMessage("unknown text", "ru")).toBe("unknown text");
  });

  it("every language has every status, stage and answer label", () => {
    for (const d of Object.values(adminDicts)) {
      expect(Object.keys(d.ui.statuses).sort()).toEqual(Object.keys(content.admin.statuses).sort());
      expect(Object.keys(d.ui.stages).sort()).toEqual(["contact", "questions", "submitted"]);
      expect(Object.keys(d.ui.answers).sort()).toEqual(["no", "yes"]);
    }
    expect(adminDicts.ru.ui.list.confirmDeleteMany(2)).toContain("2 лида");
    expect(adminDicts.ru.ui.list.confirmDeleteMany(5)).toContain("5 лидов");
  });
});
