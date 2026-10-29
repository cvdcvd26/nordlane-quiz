import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageText } from "@/components/chat/MessageText";
import {
  findTextLinks, normalizeRichTextContent, plainTextDocument, richTextPlainText, richTextSchema,
  RICH_TEXT_LIMITS, safeHttpUrl, type RichTextDocument,
} from "@/lib/rich-text";

const render = (body: string, bodyRich?: unknown) => renderToStaticMarkup(createElement("p", null, createElement(MessageText, { body, bodyRich })));
const doc = (runs: RichTextDocument["runs"]): RichTextDocument => ({ version: 1, runs });

describe("clickable chat web links", () => {
  it("retains complete Signal hash links, underscores, app-store paths and Android query parameters", () => {
    const urls = [
      "https://signal.me/#eu/wV_zwIQri5vpupS7wqNBf4Z3RJ3CsTFn8eE_F4u7FvUfiYdqJjpGJ53bLkd2Rn2y",
      "https://apps.apple.com/pl/app/signal-prywatny-komunikator/id874139669?l=pl",
      "https://play.google.com/store/apps/details?id=org.thoughtcrime.securesms&hl=pl",
    ];
    const body = `iOS ${urls[1]}\nAndroid ${urls[2]}\n\nKontakt: ${urls[0]}`;
    expect(findTextLinks(body).map(link => link.href)).toEqual([urls[1], urls[2], urls[0]]);
    const html = render(body);
    expect((html.match(/<a /g) ?? [])).toHaveLength(3);
    for (const href of urls) expect(html).toContain(`href="${href.replaceAll("&", "&amp;")}"`);
    expect((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? [])).toHaveLength(3);
  });

  it("separates sentence punctuation while preserving balanced parentheses in URLs", () => {
    const body = "Patrz (https://example.com/a_(b)), potem https://example.com/path?x=1&y=2.\nKoniec.";
    expect(findTextLinks(body).map(link => link.text)).toEqual(["https://example.com/a_(b)", "https://example.com/path?x=1&y=2"]);
    expect(render(body)).toContain("</a>), potem ");
    expect(render(body)).toContain("</a>.\nKoniec.");
  });

  it("allows www with HTTPS, but does not make bare domains, email or unsupported protocols interactive", () => {
    const body = "www.example.com/help example.org person@example.com ftp://example.com/a javascript:alert(1) data:text/html,test";
    expect(findTextLinks(body)).toEqual([{ from: 0, to: 20, text: "www.example.com/help", href: "https://www.example.com/help" }]);
    expect((render(body).match(/<a /g) ?? [])).toHaveLength(1);
  });

  it("keeps Polish characters and visual newlines intact; HTML and Markdown remain literal text", () => {
    const body = "Zażółć gęślą jaźń 👩‍💻\n**Nie pogrubiaj** <img src=x onerror=alert(1)>\nhttps://example.com/ścieżka?q=ą";
    const html = render(body);
    expect(html).toContain("Zażółć gęślą jaźń 👩‍💻\n**Nie pogrubiaj** &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<strong");
    expect(html).toContain('href="https://example.com/%C5%9Bcie%C5%BCka?q=%C4%85"');
  });

  it.each([
    "https://trusted.example@evil.example/path",
    "https://user:password@evil.example/path",
    "https://trusted.example:password@evil.example/path",
    "https://user@www.example.com/path",
    "www.trusted.example@evil.example/path",
    "name@www.example.com",
  ])("does not make any partial credential or email token interactive: %s", body => {
    expect(findTextLinks(body)).toEqual([]);
    expect(render(body)).not.toContain("<a ");
  });

  it("retains at-signs in legitimate paths, queries and fragments", () => {
    const urls = [
      "https://example.com/@person",
      "https://example.com/path?email=foo@example.com&hl=pl",
      "https://example.com/#@person",
    ];
    expect(findTextLinks(urls.join("\n")).map(link => link.href)).toEqual(urls);
  });

  it("escapes quote-based attribute injection in paths", () => {
    const html = render('https://example.com/path?x=%22onmouseover%3Dalert(1)');
    expect(html).toContain('href="https://example.com/path?x=%22onmouseover%3Dalert(1)"');
    expect(html).not.toContain(' onmouseover=');
  });
});

describe("safe HTTP destinations", () => {
  it.each([
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:foo", "file:///etc/passwd",
    "//example.com/path", "https:example.com", "mailto:user@example.com", "sgnl://linkdevice?uuid=x",
    "https://user:password@example.com", "https://example.com/line\nbreak", "https://example.com/ta\tbs",
    "https://example.com/zero\u0000byte", "https://example.com/del\u007f", "", "https://",
  ])("rejects %j", value => expect(safeHttpUrl(value)).toBeNull());

  it("normalizes host casing and optional www without changing a Signal fragment", () => {
    expect(safeHttpUrl(" HTTPS://Signal.me/#eu/a_b-c ")).toBe("https://signal.me/#eu/a_b-c");
    expect(safeHttpUrl("www.example.com")).toBe("https://www.example.com/");
  });

  it("bounds both supplied and percent-encoded URL lengths", () => {
    expect(safeHttpUrl(`https://example.com/${"a".repeat(RICH_TEXT_LIMITS.href)}`)).toBeNull();
    expect(safeHttpUrl(`https://example.com/${"ą".repeat(400)}`)).toBeNull();
  });
});

describe("versioned inline chat formatting", () => {
  it("renders nested marks and a named link without nested anchors or arbitrary HTML", () => {
    const body = "Ważne Signal: otwórz aplikację";
    const rich = doc([
      { text: "Ważne ", bold: true, italic: true, underline: true },
      { text: "Signal: otwórz aplikację", bold: true, href: "https://signal.me/#eu/a_b" },
    ]);
    const html = render(body, rich);
    expect(html).toContain("<strong><em><u>Ważne </u></em></strong>");
    expect(html).toContain('<a href="https://signal.me/#eu/a_b"');
    expect(html).toContain("<strong>Signal: otwórz aplikację</strong></a>");
    expect((html.match(/<a /g) ?? [])).toHaveLength(1);
  });

  it("does not auto-link URL-shaped text inside an explicitly named link", () => {
    const rich = doc([{ text: "https://label.example", href: "https://destination.example" }]);
    const html = render("https://label.example", rich);
    expect((html.match(/<a /g) ?? [])).toHaveLength(1);
    expect(html).toContain('href="https://destination.example/"');
  });

  it("auto-links ordinary URL runs while preserving the selected marks", () => {
    const rich = doc([{ text: "Sprawdź https://example.com\nDziękuję!", italic: true }]);
    const html = render(richTextPlainText(rich), rich);
    expect(html).toContain("<em>Sprawdź </em><a");
    expect(html).toContain("<em>https://example.com</em></a><em>\nDziękuję!</em>");
  });

  it("keeps one complete destination when style boundaries divide an automatic URL", () => {
    const rich = doc([{ text: "Otwórz https://sig", bold: true }, { text: "nal.me/#eu/a_b", underline: true }, { text: ", proszę." }]);
    const html = render(richTextPlainText(rich), rich);
    expect((html.match(/<a /g) ?? [])).toHaveLength(1);
    expect(html).toContain('href="https://signal.me/#eu/a_b"');
    expect(html).toContain("<strong>https://sig</strong><u>nal.me/#eu/a_b</u></a>, proszę.");
  });

  it("trims both body and spans across separate runs and merges equivalent adjacent marks", () => {
    const result = normalizeRichTextContent(" \nAla ma kota \t", doc([
      { text: " \n", bold: true }, { text: "Ala ", italic: true }, { text: "ma ", italic: true },
      { text: "kota \t", bold: true },
    ]));
    expect(result).toEqual({ body: "Ala ma kota", bodyRich: doc([{ text: "Ala ma ", italic: true }, { text: "kota", bold: true }]) });
  });

  it("preserves Polish and emoji sequences while trimming UTF-16 offsets", () => {
    const result = normalizeRichTextContent("  👩‍💻 Łódź\n🤝  ", doc([{ text: "  👩‍💻", bold: true }, { text: " Łódź\n🤝  ", underline: true }]));
    expect(result.body).toBe("👩‍💻 Łódź\n🤝");
    expect(result.bodyRich?.runs).toEqual([{ text: "👩‍💻", bold: true }, { text: " Łódź\n🤝", underline: true }]);
  });

  it("collapses unformatted and whitespace-only documents to null while retaining untrimmed draft helpers", () => {
    const draft = plainTextDocument("  przykład \n");
    expect(richTextPlainText(draft)).toBe("  przykład \n");
    expect(normalizeRichTextContent("  przykład \n", draft)).toEqual({ body: "przykład", bodyRich: null });
    expect(normalizeRichTextContent(" \n ", doc([{ text: " \n ", bold: true }]))).toEqual({ body: "", bodyRich: null });
    expect(plainTextDocument("")).toEqual(doc([]));
    expect(normalizeRichTextContent("Stara wiadomość")).toEqual({ body: "Stara wiadomość", bodyRich: null });
  });

  it("normalizes hrefs and validates body length for message and template limits", () => {
    expect(normalizeRichTextContent("Strona", doc([{ text: "Strona", href: "www.example.com" }]))).toEqual({ body: "Strona", bodyRich: doc([{ text: "Strona", href: "https://www.example.com/" }]) });
    expect(() => normalizeRichTextContent("a".repeat(2001), undefined, 2000)).toThrow();
    expect(() => normalizeRichTextContent("a".repeat(4001))).toThrow();
  });

  it.each([
    { version: 2, runs: [{ text: "A" }] },
    { version: 1, runs: [{ text: "A", bold: false }] },
    { version: 1, runs: [{ text: "A", html: "<script>evil</script>" }] },
    { version: 1, runs: [{ text: "A", href: "javascript:alert(1)" }] },
    { version: 1, runs: [{ text: "A", href: "data:text/html,x" }] },
    { version: 1, runs: [{ text: "A", onClick: "evil" }] },
    { version: 1, runs: [{ text: "" }] },
    { version: 1, runs: [{ text: "A" }], html: "<img>" },
  ])("rejects unsupported or executable metadata %j", value => {
    expect(richTextSchema.safeParse(value).success).toBe(false);
  });

  it("rejects documents that disagree with the displayed plain message", () => {
    expect(() => normalizeRichTextContent("Public body", doc([{ text: "Different text", bold: true }]))).toThrow();
  });

  it("limits run counts and total encoded metadata, including repeated long URLs", () => {
    expect(richTextSchema.safeParse(doc(Array.from({ length: RICH_TEXT_LIMITS.runs + 1 }, () => ({ text: "a" })))).success).toBe(false);
    const large = doc(Array.from({ length: 100 }, () => ({ text: "ą", href: `https://example.com/${"x".repeat(200)}` })));
    expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeGreaterThan(RICH_TEXT_LIMITS.bytes);
    expect(richTextSchema.safeParse(large).success).toBe(false);
  });

  it("falls back to escaped, clickable plain text for corrupt stored metadata without hiding messages", () => {
    const body = "<script>bad()</script> https://example.com";
    const html = render(body, { version: 1, runs: [{ text: body, href: "javascript:alert(1)" }] });
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain('href="https://example.com/"');
    expect(html).not.toContain('href="javascript:');
  });
});
