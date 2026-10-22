"use client";
import { useRef, useState } from "react";
import { content } from "@/config/content";
import { api, formatBytes, uploadWithProgress, type PublicFile } from "@/lib/api";
import type { QuickReply } from "@/lib/quick-replies";

type Attachment = { key: string; name: string; size: number; status: "uploading" | "done" | "error"; file?: PublicFile; error?: string };

/**
 * Message input: Enter sends, Shift+Enter adds a new line.
 * Attachments upload immediately; the message is sent with their ids.
 */
export function Composer({
  onSend,
  uploadUrl,
  uploadPurpose,
  accept,
  attachmentsEnabled,
  maxFiles,
  text: labels = content.chat,
  placeholder = labels.placeholder,
  translateError = (e: Error) => e.message,
  appearance = "visitor",
  quickReplies,
}: {
  onSend: (body: string, files: PublicFile[]) => void | Promise<void>;
  uploadUrl: string;
  uploadPurpose?: "chat";
  accept: string[];
  attachmentsEnabled: boolean;
  maxFiles: number;
  placeholder?: string;
  /** Labels; the admin panel passes its own language. */
  text?: { placeholder: string; send: string; attach: string; removeAttachment: (name: string) => string };
  translateError?: (e: Error) => string;
  appearance?: "visitor" | "admin";
  quickReplies?: { items: QuickReply[]; label: string; select: string; hint: string; manage: string; empty: string; tooLong: string };
}) {
  const adm = appearance === "admin";
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [templateError, setTemplateError] = useState(false);
  const busyRef = useRef(false);
  const removed = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const uploading = files.some((f) => f.status === "uploading");
  const ready = files.filter((f) => f.status === "done" && f.file).map((f) => f.file!);
  const canSend = !busy && !uploading && (text.trim().length > 0 || ready.length > 0);

  const insertReply = (id: string) => {
    const reply = quickReplies?.items.find(item => item.id === id);
    if (!reply || busyRef.current) return;
    const next = text.trim() ? `${text.trimEnd()}\n\n${reply.body}` : reply.body;
    if (next.length > 4000) { setTemplateError(true); return; }
    setText(next); setTemplateError(false);
    requestAnimationFrame(() => {
      const element = area.current;
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
      element.focus();
      element.setSelectionRange(next.length, next.length);
    });
  };

  const send = async () => {
    if (!canSend || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onSend(text.trim(), ready);
      setText("");
      setFiles([]);
      area.current?.focus();
    } catch {
      // Text stays in the field; the parent shows the error.
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const deleteFile = (file: PublicFile) => api(uploadPurpose ? `/api/uploads/${file.id}` : uploadUrl,
    { method: "DELETE", ...(uploadPurpose ? {} : { json: { fileId: file.id } }) });

  const remove = async (attachment: Attachment) => {
    if (busyRef.current) return;
    removed.current.add(attachment.key);
    setFiles((p) => p.filter((x) => x.key !== attachment.key));
    if (attachment.file) {
      try { await deleteFile(attachment.file); }
      catch (err) {
        removed.current.delete(attachment.key);
        setFiles((p) => [...p, { ...attachment, error: translateError(err as Error) }]);
      }
    }
  };

  const attach = (list: FileList) => {
    if (busyRef.current) return;
    Array.from(list)
      .slice(0, Math.max(0, maxFiles - files.length))
      .forEach((file) => {
        const key = `${file.name}-${file.size}-${Math.random()}`;
        setFiles((p) => [...p, { key, name: file.name, size: file.size, status: "uploading" }]);
        const form = new FormData();
        form.set("file", file);
        if (uploadPurpose) form.set("purpose", uploadPurpose);
        uploadWithProgress<{ file: PublicFile }>(uploadUrl, form, () => {})
          .promise.then(async ({ file: saved }) => {
            if (removed.current.has(key)) { await deleteFile(saved); return; }
            setFiles((p) => p.map((f) => f.key === key ? { ...f, status: "done", file: saved } : f));
          })
          .catch((err) => setFiles((p) => p.map((f) => (f.key === key ? { ...f, status: "error", error: translateError(err) } : f))));
      });
  };

  return (
    <div
      className={
        adm
          ? "rounded-lg border border-adm-line-strong bg-adm-surface p-1.5 transition-[border-color,box-shadow] focus-within:border-adm-accent focus-within:shadow-[0_0_0_3px_#0f6fd626]"
          : "rounded-(--radius-tile) border border-line-strong bg-white/[0.03] p-2 transition-[border-color,box-shadow] focus-within:border-paint focus-within:shadow-[0_0_0_4px_#2ee6a01f]"
      }
    >
      {adm && quickReplies && <div className="border-b border-adm-line px-2 pt-1.5 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="composer-quick-reply" className="sr-only">{quickReplies.label}</label>
          <select id="composer-quick-reply" className="adm-input min-w-0 flex-1 text-[12.5px]" value="" disabled={busy || !quickReplies.items.length} onChange={event => insertReply(event.target.value)}>
            <option value="">{quickReplies.items.length ? quickReplies.select : quickReplies.empty}</option>
            {quickReplies.items.map(reply => <option key={reply.id} value={reply.id}>{reply.title}</option>)}
          </select>
          <a href="/admin/settings#quick-replies" className="text-[12px] font-medium text-adm-accent hover:underline">{quickReplies.manage}</a>
        </div>
        <p className="adm-help mt-1.5 leading-relaxed">{quickReplies.hint}</p>
        {templateError && <p role="alert" className="mt-1 text-[12px] text-adm-red">{quickReplies.tooLong}</p>}
      </div>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 px-2 pt-1 pb-2">
          {files.map((f) => (
            <li
              key={f.key}
              className={`flex items-center gap-2 px-3 py-1 text-xs ${adm ? "rounded-md" : "rounded-full"} ${
                f.status === "error" ? (adm ? "bg-adm-red-bg text-adm-red" : "bg-danger-soft text-danger") : adm ? "bg-adm-subtle" : "bg-white/5"
              }`}
              title={f.error}
            >
              <span className="max-w-40 truncate">{f.name}</span>
              <span className={adm ? "text-adm-ink-3" : "text-slate"}>{f.status === "uploading" ? "…" : f.status === "error" ? "!" : formatBytes(f.size)}</span>
              <button type="button" aria-label={labels.removeAttachment(f.name)} disabled={busy} onClick={() => void remove(f)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        {attachmentsEnabled && (
          <>
            <button
              type="button"
              className={
                adm
                  ? "grid size-9 shrink-0 place-items-center rounded-md text-adm-ink-3 transition-colors hover:bg-adm-subtle hover:text-adm-ink"
                  : "grid size-11 shrink-0 place-items-center rounded-full text-xl text-slate transition-colors hover:bg-white/5 hover:text-cyan"
              }
              aria-label={labels.attach}
              title={labels.attach}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6" />
              </svg>
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept={accept.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                if (e.target.files) attach(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <label className="sr-only" htmlFor="composer">
          {placeholder}
        </label>
        <textarea
          id="composer"
          ref={area}
          disabled={busy}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTemplateError(false);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          maxLength={4000}
          className={`max-h-44 flex-1 resize-none bg-transparent px-2 outline-none ${
            adm ? "min-h-9 py-2 text-[13.5px] placeholder:text-adm-ink-3" : "min-h-11 py-2.5 placeholder:text-slate"
          }`}
        />
        <button type="button" className={adm ? "adm-btn adm-btn-primary h-9 shrink-0 px-4" : "btn btn-primary h-11 min-h-0 shrink-0 px-5"} onClick={send} disabled={!canSend}>
          {labels.send}
        </button>
      </div>
    </div>
  );
}
