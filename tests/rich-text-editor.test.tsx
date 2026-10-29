// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RichTextEditor, { type RichTextEditorHandle } from "@/components/admin/RichTextEditor";
import { createRichTextExtensions } from "@/components/admin/rich-text-extensions";
import { appendRichTextTemplate, editorJsonToRichText, richTextToEditorJson, type RichTextValue } from "@/lib/rich-text-editor";
import { normalizeRichTextContent, type RichTextDocument } from "@/lib/rich-text";

const editors: Editor[] = [];
const roots: Root[] = [];
const rich = (...runs: RichTextDocument["runs"]): RichTextDocument => ({ version: 1, runs });

function editorFor(value: RichTextValue, maxLength = 4000, onLimit = vi.fn()) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: createRichTextExtensions(maxLength, onLimit), content: richTextToEditorJson(value), enableInputRules: false, enablePasteRules: false });
  editors.push(editor);
  return editor;
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => roots.splice(0).forEach(root => root.unmount()));
  editors.splice(0).forEach(editor => editor.destroy());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("formatted draft codec", () => {
  it("preserves spaces, empty lines, emoji and Polish characters while typing", () => {
    const body = "  Cześć, Łucja 👩‍💻!\n\nDruga linia\n ";
    const value = { body, bodyRich: null };
    expect(editorJsonToRichText(richTextToEditorJson(value))).toEqual(value);
  });

  it("round-trips nested supported marks and the full Signal URL without interpreting HTML", () => {
    const href = "https://signal.me/#eu/a_B-c123";
    const value = { body: "Cześć 👋 Otwórz <script>\nDalej", bodyRich: rich(
      { text: "Cześć 👋 ", bold: true, underline: true },
      { text: "Otwórz", italic: true, href },
      { text: " <script>\nDalej" },
    ) };
    expect(editorJsonToRichText(richTextToEditorJson(value))).toEqual(value);
    const editor = editorFor(value);
    expect(editor.view.dom.querySelector("script")).toBeNull();
    expect(editor.view.dom.querySelector("a")?.getAttribute("href")).toBe(href);
    expect(editor.view.dom.textContent).toContain("<script>");
  });

  it("falls back to the actual plain text if stale metadata describes a different draft", () => {
    expect(editorJsonToRichText(richTextToEditorJson({ body: "Actual", bodyRich: rich({ text: "Different", bold: true }) }))).toEqual({ body: "Actual", bodyRich: null });
  });

  it("retains both drafts' formatting and trims only the old draft's trailing whitespace when appending", () => {
    const result = appendRichTextTemplate(
      { body: "  Wstęp  \n", bodyRich: rich({ text: "  Wstęp  \n", underline: true }) },
      { body: "Potwierdzenie", bodyRich: rich({ text: "Potwierdzenie", bold: true }) },
    );
    expect(result).toEqual({ body: "  Wstęp\n\nPotwierdzenie", bodyRich: rich({ text: "  Wstęp", underline: true }, { text: "\n\n" }, { text: "Potwierdzenie", bold: true }) });
    expect(normalizeRichTextContent(result.body, result.bodyRich)).toEqual({ body: "Wstęp\n\nPotwierdzenie", bodyRich: rich({ text: "Wstęp", underline: true }, { text: "\n\n" }, { text: "Potwierdzenie", bold: true }) });
  });

  it("replaces a whitespace-only draft with the selected template", () => {
    const template = { body: "Gotowe", bodyRich: rich({ text: "Gotowe", italic: true }) };
    expect(appendRichTextTemplate({ body: "  \n", bodyRich: null }, template)).toEqual(template);
  });
});

describe("actual editor schema, selection and transaction behavior", () => {
  it("formats only the selected range and supports undo/redo without changing the message text", () => {
    const editor = editorFor({ body: "Ala ma kota", bodyRich: null });
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.chain().toggleBold().toggleUnderline().run();
    expect(editorJsonToRichText(editor.getJSON())).toEqual({ body: "Ala ma kota", bodyRich: rich({ text: "Ala", bold: true, underline: true }, { text: " ma kota" }) });
    editor.commands.undo();
    expect(editorJsonToRichText(editor.getJSON())).toEqual({ body: "Ala ma kota", bodyRich: null });
    editor.commands.redo();
    expect(editorJsonToRichText(editor.getJSON()).bodyRich?.runs[0]).toMatchObject({ text: "Ala", bold: true, underline: true });
  });

  it("keeps named links and rejects active non-web protocols", () => {
    const editor = editorFor({ body: "Pobierz", bodyRich: null });
    editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
    expect(editorJsonToRichText(editor.getJSON()).bodyRich).toBeNull();
    editor.commands.setLink({ href: "https://apps.apple.com/pl/app/signal/id874139669?l=pl" });
    expect(editorJsonToRichText(editor.getJSON()).bodyRich?.runs).toEqual([{ text: "Pobierz", href: "https://apps.apple.com/pl/app/signal/id874139669?l=pl" }]);
  });

  it("sanitizes pasted HTML through the allowlisted schema", () => {
    const editor = editorFor({ body: "", bodyRich: null });
    editor.commands.setContent('<p><strong>Ważne</strong> <u>test</u> <a href="javascript:alert(1)">link</a><img src="x" onerror="alert(1)"><script>alert(2)</script></p>');
    const value = editorJsonToRichText(editor.getJSON());
    expect(value.body).toBe("Ważne test link");
    expect(value.bodyRich?.runs).toEqual([{ text: "Ważne", bold: true }, { text: " " }, { text: "test", underline: true }, { text: " link" }]);
    expect(editor.view.dom.querySelector("img,script,a")).toBeNull();
    expect(editor.schema.nodes).not.toHaveProperty("heading");
    expect(editor.schema.nodes).not.toHaveProperty("bulletList");
  });

  it("blocks oversized paste/typing atomically and leaves the previous text intact", async () => {
    const onLimit = vi.fn();
    const editor = editorFor({ body: "1234", bodyRich: null }, 5, onLimit);
    editor.commands.setTextSelection(5);
    editor.commands.insertContent("56");
    await Promise.resolve();
    expect(editorJsonToRichText(editor.getJSON()).body).toBe("1234");
    expect(onLimit).toHaveBeenCalledOnce();
    editor.commands.insertContent("5");
    expect(editorJsonToRichText(editor.getJSON()).body).toBe("12345");
  });

  it("preserves literal Markdown punctuation and hard-break text", () => {
    const editor = editorFor({ body: "**zwykły tekst**", bodyRich: null });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.setHardBreak();
    editor.commands.insertContent("_kolejna linia_");
    expect(editorJsonToRichText(editor.getJSON())).toEqual({ body: "**zwykły tekst**\n_kolejna linia_", bodyRich: null });
  });
});

describe("React editor lifecycle and keyboard integration", () => {
  it("updates external content without stale formatting and respects disabled state", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const editorRef = createRef<RichTextEditorHandle>();
    const onChange = vi.fn();
    const props = { id: "draft", label: "Wiadomość", maxLength: 2000, uiLang: "ru" as const, onChange, editorRef };
    await act(async () => root.render(createElement(RichTextEditor, { ...props, value: { body: "Pierwszy", bodyRich: rich({ text: "Pierwszy", bold: true }) } })));
    expect(container.querySelector('[role="textbox"] strong')?.textContent).toBe("Pierwszy");
    await act(async () => root.render(createElement(RichTextEditor, { ...props, disabled: true, value: { body: "Другой текст", bodyRich: null } })));
    expect(container.querySelector('[role="textbox"]')?.textContent).toBe("Другой текст");
    expect(container.querySelector('[role="textbox"] strong')).toBeNull();
    expect(container.querySelector('[role="textbox"]')?.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelectorAll("button:not(:disabled)")).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(editorRef.current).toHaveProperty("focusEnd");
  });

  it("sends on Enter, allows Shift+Enter and does not send during IME composition", async () => {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); roots.push(root);
    const onSubmit = vi.fn();
    await act(async () => root.render(createElement(RichTextEditor, { id: "send-draft", label: "Message", maxLength: 4000, uiLang: "en", value: { body: "Test", bodyRich: null }, onChange: vi.fn(), onSubmit })));
    const area = container.querySelector('[role="textbox"]')!;
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(onSubmit).toHaveBeenCalledOnce();
    await act(async () => { area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true })); });
    expect(onSubmit).toHaveBeenCalledOnce();
    const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => { area.dispatchEvent(shiftEnter); });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
