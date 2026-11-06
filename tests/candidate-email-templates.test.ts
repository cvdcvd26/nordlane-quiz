import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { buildCandidateEmailTemplate, escapeEmailHtml } from "@/server/candidate-email-templates";
import { brand, company } from "@/config/brand";

const site = "https://itsolution.fun";
const templates = [
  buildCandidateEmailTemplate({ kind: "otp", site, code: "012345" }),
  buildCandidateEmailTemplate({ kind: "welcome", site }),
  buildCandidateEmailTemplate({ kind: "chat", site }),
];

describe("transactional email presentation", () => {
  it.each(templates)("provides semantic Polish HTML and a complete plain-text fallback: $subject", template => {
    const window = new Window();
    window.document.write(template.html);
    const document = window.document;
    expect(document.documentElement.lang).toBe("pl");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.title).toBe(template.subject);
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute("content")).toBe("width=device-width, initial-scale=1");
    expect(document.querySelector('table[style*="max-width:600px"]')).not.toBeNull();
    expect([...document.querySelectorAll("table")].every(table => table.getAttribute("role") === "presentation")).toBe(true);
    expect(template.text).toContain(brand.name);
    expect(template.text).toContain(company.name);
    expect(template.text).toContain(company.address);
    expect(template.text).toContain(site);
    expect(template.text).not.toMatch(/<\/?(?:p|a|table|html)\b/);
    window.happyDOM.abort();
  });

  it.each(templates)("contains no remote resources, tracking, executable markup or secret links: $subject", template => {
    const window = new Window();
    window.document.write(template.html);
    const document = window.document;
    expect(document.querySelector("img,script,svg,iframe,link,form,object,embed,video,audio")).toBeNull();
    expect(document.querySelector("[src],[srcset],[background],[onclick],[onerror],[onload]")).toBeNull();
    expect(template.html).not.toMatch(/url\s*\(|@import|javascript:|data:/i);
    const links = [...document.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(site);
      expect(link.textContent.trim()).not.toBe("");
    }
    window.happyDOM.abort();
  });

  it("keeps all six OTP digits together as selectable text, outside subject and preheader", () => {
    const template = templates[0];
    const window = new Window();
    window.document.write(template.html);
    const code = window.document.querySelector('span[style*="user-select:text"]');
    expect(code?.textContent).toBe("012345");
    expect(template.subject).not.toContain("012345");
    expect(window.document.querySelector('div[style*="display:none"]')?.textContent).not.toContain("012345");
    expect(template.html).toContain("10 minut");
    expect(template.text).toContain("tylko raz");
    window.happyDOM.abort();
  });

  it("keeps the verified-account and unread-message instructions specific to their existing scenarios", () => {
    expect(templates[1].text).toContain("Moje zgłoszenie");
    expect(templates[1].text).toContain("jednorazowym kodem");
    expect(templates[1].text).toContain("W zapisanej sesji zgłoszenie otworzy się automatycznie");
    expect(templates[2].text).toContain("raz na 3 godziny");
    expect(templates[2].text).toContain("tylko gdy pojawią się nowe nieprzeczytane wiadomości");
    expect(templates[2].text).toContain("nie dołączamy treści rozmowy ani dokumentów");
  });

  it("escapes markup-significant characters without losing Polish letters", () => {
    expect(escapeEmailHtml('<a href="x">Łódź & Gdańsk\'s</a>'))
      .toBe("&lt;a href=&quot;x&quot;&gt;Łódź &amp; Gdańsk&#39;s&lt;/a&gt;");
  });

  it.each(["http://itsolution.fun", "javascript:alert(1)", "data:text/html,test", "https://example.com/path",
    "https://example.com?token=secret", "https://example.com/#login", "https://user:password@example.com",
    " https://example.com", "https://example.com\n"])("rejects non-canonical or unsafe site URLs: %s", unsafeSite => {
    expect(() => buildCandidateEmailTemplate({ kind: "chat", site: unsafeSite })).toThrow();
  });

  it.each(["12345", "1234567", "123 456", "<script>", "ABCDEF"])("rejects invalid OTPs: %s", code => {
    expect(() => buildCandidateEmailTemplate({ kind: "otp", site, code })).toThrow("candidate_email_invalid_code");
  });
});
