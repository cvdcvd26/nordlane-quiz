"use client";

import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Eraser, Italic, Link2, Redo2, Underline, Undo2, X, type LucideIcon } from "lucide-react";
import { richTextCopy } from "@/config/rich-text-copy";
import { safeHttpUrl } from "@/lib/rich-text";
import { editorJsonToRichText, richTextToEditorJson, type RichTextValue } from "@/lib/rich-text-editor";
import { createRichTextExtensions } from "./rich-text-extensions";

export type RichTextEditorHandle = { focus: () => void; focusEnd: () => void };

export type RichTextEditorProps = {
  id: string;
  label: string;
  value: RichTextValue;
  onChange: (value: RichTextValue) => void;
  maxLength: number;
  uiLang: "pl" | "ru" | "en";
  disabled?: boolean;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  onSubmit?: () => void;
  editorRef?: Ref<RichTextEditorHandle>;
};

function ToolbarButton({ label, Icon, pressed, disabled, onClick }: { label: string; Icon: LucideIcon; pressed?: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}><Icon aria-hidden className="size-3.5" /></button>;
}

export default function RichTextEditor({ id, label, value, onChange, maxLength, uiLang, disabled = false, placeholder = "", compact = false, autoFocus = false, onSubmit, editorRef }: RichTextEditorProps) {
  const T = richTextCopy[uiLang];
  const [limitHit, setLimitHit] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [existingLink, setExistingLink] = useState(false);
  const linkDialog = useRef<HTMLDialogElement>(null);
  const linkSelection = useRef({ from: 1, to: 1, existing: false });
  const submitRef = useRef(onSubmit);
  const linkId = useId();
  useEffect(() => { submitRef.current = onSubmit; }, [onSubmit]);

  const extensions = useMemo(() => createRichTextExtensions(maxLength, () => setLimitHit(true)), [maxLength]);

  const editor = useEditor({
    extensions,
    content: richTextToEditorJson(value),
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: !disabled,
    enableInputRules: false,
    enablePasteRules: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        id, role: "textbox", "aria-label": label, "aria-multiline": "true", "aria-describedby": `${id}-help`, lang: "pl",
        "data-placeholder": placeholder, class: "adm-rich-text-input",
      },
      handleKeyDown: (_view, event) => {
        if (!_view.editable || event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229 || !submitRef.current) return false;
        event.preventDefault();
        submitRef.current();
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      setLimitHit(false);
      onChange(editorJsonToRichText(current.getJSON()));
    },
  }, [maxLength]);

  const active = useEditorState({ editor, selector: ({ editor: current }) => current ? ({
    bold: current.isActive("bold"), italic: current.isActive("italic"), underline: current.isActive("underline"), link: current.isActive("link"),
    undo: current.can().undo(), redo: current.can().redo(),
  }) : null });

  useImperativeHandle(editorRef, () => ({
    focus: () => { editor?.commands.focus(); },
    focusEnd: () => { editor?.commands.focus("end"); },
  }), [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editorJsonToRichText(editor.getJSON());
    if (current.body !== value.body || JSON.stringify(current.bodyRich) !== JSON.stringify(value.bodyRich)) {
      editor.commands.setContent(richTextToEditorJson(value), { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
    editor?.setOptions({ editorProps: { ...editor.options.editorProps, attributes: {
      id, role: "textbox", "aria-label": label, "aria-multiline": "true", "aria-disabled": String(disabled), "aria-describedby": `${id}-help`, lang: "pl",
      "data-placeholder": placeholder, class: "adm-rich-text-input",
    } } });
  }, [editor, disabled, id, label, placeholder]);

  useEffect(() => {
    const dialog = linkDialog.current;
    if (!linkOpen || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [linkOpen]);

  const closeLink = () => {
    setLinkOpen(false);
    requestAnimationFrame(() => editor?.commands.focus());
  };
  const openLink = () => {
    if (!editor || disabled) return;
    const { from, to } = editor.state.selection;
    linkSelection.current = { from, to, existing: editor.isActive("link") };
    setUrl(typeof editor.getAttributes("link").href === "string" ? editor.getAttributes("link").href : "");
    setExistingLink(editor.isActive("link"));
    setLinkError(false); setLinkOpen(true);
  };
  const applyLink = (remove = false) => {
    if (!editor || disabled) return;
    const href = remove ? null : safeHttpUrl(url);
    if (!remove && !href) { setLinkError(true); return; }
    const selection = linkSelection.current;
    setLinkOpen(false);
    requestAnimationFrame(() => {
      const chain = editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to });
      if (selection.existing) chain.extendMarkRange("link");
      if (remove) chain.unsetLink().run();
      else if (selection.from === selection.to && !selection.existing) chain.insertContent({ type: "text", text: href!, marks: [{ type: "link", attrs: { href } }] }).run();
      else chain.setLink({ href: href! }).run();
    });
  };


  return <div className={`adm-rich-text ${compact ? "adm-rich-text-compact" : ""}`} data-disabled={disabled}>
    <div className="adm-rich-text-toolbar" role="toolbar" aria-label={T.toolbar} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !buttons.length) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }}>
      <ToolbarButton label={T.bold} Icon={Bold} pressed={Boolean(active?.bold)} disabled={disabled || !editor} onClick={() => { editor?.chain().focus().toggleBold().run(); }} />
      <ToolbarButton label={T.italic} Icon={Italic} pressed={Boolean(active?.italic)} disabled={disabled || !editor} onClick={() => { editor?.chain().focus().toggleItalic().run(); }} />
      <ToolbarButton label={T.underline} Icon={Underline} pressed={Boolean(active?.underline)} disabled={disabled || !editor} onClick={() => { editor?.chain().focus().toggleUnderline().run(); }} />
      <ToolbarButton label={T.link} Icon={Link2} pressed={Boolean(active?.link)} disabled={disabled || !editor} onClick={openLink} />
      <ToolbarButton label={T.clear} Icon={Eraser} disabled={disabled || !editor} onClick={() => { editor?.chain().focus().unsetAllMarks().run(); }} />
      <ToolbarButton label={T.undo} Icon={Undo2} disabled={disabled || !editor || !active?.undo} onClick={() => { editor?.chain().focus().undo().run(); }} />
      <ToolbarButton label={T.redo} Icon={Redo2} disabled={disabled || !editor || !active?.redo} onClick={() => { editor?.chain().focus().redo().run(); }} />
    </div>
    {editor ? <EditorContent editor={editor} /> : <div className="adm-rich-text-loading" role="status">{T.loading}</div>}
    <div className="adm-rich-text-help" id={`${id}-help`}><span role={limitHit ? "alert" : undefined} className={limitHit ? "text-adm-red" : ""}>{limitHit ? T.limit : T.hint}</span><span>{value.body.length}/{maxLength}</span></div>
    {linkOpen ? <dialog ref={linkDialog} className="adm-rich-link-dialog" aria-labelledby={`${linkId}-title`} onCancel={event => { event.preventDefault(); event.stopPropagation(); closeLink(); }}>
      <div className="flex items-center justify-between gap-3 border-b border-adm-line px-4 py-3"><h3 id={`${linkId}-title`} className="adm-section-title">{T.linkTitle}</h3><button type="button" className="adm-btn size-8 p-0" aria-label={T.cancel} onClick={closeLink}><X aria-hidden className="size-4" /></button></div>
      <div className="space-y-3 p-4">
        <label className="adm-label" htmlFor={`${linkId}-url`}>{T.url}</label>
        <input autoFocus id={`${linkId}-url`} className="adm-input" type="url" autoComplete="off" spellCheck={false} value={url} placeholder={T.urlPlaceholder} maxLength={2048} onChange={event => { setUrl(event.target.value); setLinkError(false); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); applyLink(); } }} aria-invalid={linkError} aria-describedby={linkError ? `${linkId}-error` : undefined} />
        {linkError ? <p id={`${linkId}-error`} role="alert" className="text-[12.5px] text-adm-red">{T.invalidUrl}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">{existingLink ? <button type="button" className="adm-btn mr-auto" onClick={() => applyLink(true)}>{T.remove}</button> : null}<button type="button" className="adm-btn" onClick={closeLink}>{T.cancel}</button><button type="button" className="adm-btn adm-btn-primary" onClick={() => applyLink()}>{T.apply}</button></div>
      </div>
    </dialog> : null}
  </div>;
}
