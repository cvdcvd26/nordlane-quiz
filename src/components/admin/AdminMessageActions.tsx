"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Pencil, Trash2, X } from "lucide-react";
import { messageActionCopy } from "@/config/message-actions";
import { ApiError, type ChatMessage } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { normalizeRichTextContent, type RichTextDocument } from "@/lib/rich-text";
const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

export function AdminMessageActions({ message, onChange }: { message: ChatMessage; onChange: (message: ChatMessage, action: "edit" | "delete", body: string, bodyRich?: RichTextDocument | null) => Promise<void> }) {
  const { lang, err: tErr } = useAdminI18n();
  const T = messageActionCopy[lang];
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [original, setOriginal] = useState(message);
  const [body, setBody] = useState("");
  const [bodyRich, setBodyRich] = useState<RichTextDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!mode || !node) return;
    node.showModal();
    return () => node.close();
  }, [mode]);
  const open = (mode: "edit" | "delete") => { setOriginal(message); setBody(message.body); setBodyRich(message.bodyRich ?? null); setError(null); setMode(mode); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mode || busy) return;
    setBusy(true); setError(null);
    try {
      const value = mode === "edit" ? normalizeRichTextContent(body, bodyRich, 4000) : { body, bodyRich: null };
      await onChange(original, mode, value.body, value.bodyRich); setMode(null);
    }
    catch (error) { setError(error instanceof ApiError && error.code === "message_changed" ? T.conflict : tErr(error)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <span className="inline-flex items-center gap-2">
        <button type="button" className="inline-flex items-center gap-1 hover:text-adm-accent" onClick={() => open("edit")}><Pencil aria-hidden className="size-3" />{T.edit}</button>
        <button type="button" className="inline-flex items-center gap-1 hover:text-adm-red" onClick={() => open("delete")}><Trash2 aria-hidden className="size-3" />{T.remove}</button>
      </span>
      {mode && <dialog ref={dialog} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!busy) setMode(null); }}
        className="m-auto max-h-[90dvh] w-[92vw] max-w-xl overflow-auto rounded-xl border border-adm-line bg-adm-surface p-0 text-adm-ink shadow-2xl backdrop:bg-black/45">
        <header className="flex items-center gap-3 border-b border-adm-line px-5 py-4">
          <h2 id={`${id}-title`} className="flex-1 text-lg font-bold">{mode === "edit" ? T.editTitle : T.deleteTitle}</h2>
          <button type="button" aria-label={T.cancel} className="adm-btn adm-btn-quiet size-8 p-0" disabled={busy} onClick={() => setMode(null)}><X aria-hidden className="size-4" /></button>
        </header>
        <form onSubmit={submit} className="space-y-4 p-5" aria-busy={busy}>
          {mode === "edit" ? <>
            <label htmlFor={`${id}-body`} className="adm-label">{T.body}</label>
            <RichTextEditor id={`${id}-body`} autoFocus label={T.body} value={{ body, bodyRich }} onChange={value => { setBody(value.body); setBodyRich(value.bodyRich); }} disabled={busy} maxLength={4000} uiLang={lang} />
            {original.files.length > 0 && <p className="adm-help">{T.filesHint}</p>}
          </> : <p className="text-[13.5px] leading-relaxed">{T.deleteHint}</p>}
          {error && <p role="alert" className="text-[13px] text-adm-red">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="adm-btn" disabled={busy} onClick={() => setMode(null)}>{T.cancel}</button>
            <button type="submit" className={`adm-btn ${mode === "delete" ? "adm-btn-danger-solid" : "adm-btn-primary"}`} disabled={busy || (mode === "edit" && !body.trim() && original.files.length === 0)}>{busy ? T.working : mode === "edit" ? T.save : T.remove}</button>
          </div>
        </form>
      </dialog>}
    </>
  );
}
