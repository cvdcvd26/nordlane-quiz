"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { revisionConfig, revisionCopy, type TaskRevision } from "@/config/task-revisions";
import { api, ApiError, newId, type PublicFile } from "@/lib/api";
import { useAdminDraftGuard } from "@/lib/admin-draft-guard";
import { useAdminI18n } from "./i18n";

type RevisionHistory = {
  hasSubmission: boolean;
  closed: boolean;
  revisions: (TaskRevision & { response: { body: string; files: PublicFile[] } | null })[];
};

export default function LeadRevisionManager({ leadId, onChange }: { leadId: number; onChange?: () => void }) {
  const { lang, time, err: tErr } = useAdminI18n();
  const T = revisionCopy[lang];
  const [history, setHistory] = useState<RevisionHistory | null>(null);
  const [instructions, setInstructions] = useState("");
  useAdminDraftGuard(`lead:${leadId}`, instructions.length > 0);
  const [sendMessage, setSendMessage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestId = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const messageFor = useCallback((error: unknown) => error instanceof ApiError && error.code && revisionCopy[lang].errors[error.code]
    ? revisionCopy[lang].errors[error.code] : tErr(error), [lang, tErr]);
  const url = `/api/admin/leads/${leadId}/revisions`;

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const controller = new AbortController();
    const load = async () => {
      if (polling || document.hidden) return;
      polling = true;
      try {
        const value = await api<RevisionHistory>(url, { signal: controller.signal });
        if (!disposed) { setHistory(value); setError(null); }
      } catch (error) { if (!disposed) setError(messageFor(error)); }
      finally { polling = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    document.addEventListener("visibilitychange", load);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [url, reload, messageFor]);

  const request = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !instructions.trim()) return;
    requestId.current ??= newId();
    setBusy(true); setError(null);
    try {
      await api(url, { method: "POST", json: { id: requestId.current, instructions, sendMessage } });
      requestId.current = null; setInstructions(""); setReload(value => value + 1); onChangeRef.current?.();
    } catch (error) { setError(messageFor(error)); }
    finally { setBusy(false); }
  };

  const cancel = async (revisionId: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api(`${url}/${revisionId}/cancel`, { method: "POST" });
      setReload(value => value + 1); onChangeRef.current?.();
    } catch (error) { setError(messageFor(error)); setReload(value => value + 1); }
    finally { setBusy(false); }
  };
  const pending = history?.revisions.some(revision => revision.status === "pending");

  return (
    <section className="adm-panel" aria-labelledby={`revision-title-${leadId}`}>
      <div className="border-b border-adm-line px-4 py-4">
        <h2 id={`revision-title-${leadId}`} className="adm-section-title">{T.title}</h2>
        <p className="adm-help mt-1.5 leading-relaxed">{T.hint}</p>
      </div>
      <div className="space-y-4 p-4">
        {!history && !error && <p className="adm-help" role="status">{T.loading}</p>}
        {history && !history.hasSubmission && <p className="adm-help">{T.noSubmission}</p>}
        {history?.closed && <p className="adm-help">{T.closed}</p>}
        {history?.hasSubmission && !history.closed && !pending && <form onSubmit={request}>
          <fieldset disabled={busy} className="space-y-3">
            <label htmlFor={`revision-instructions-${leadId}`} className="adm-label">{T.instructions}</label>
            <textarea id={`revision-instructions-${leadId}`} lang="pl" className="adm-input min-h-28" value={instructions} maxLength={revisionConfig.maxInstructionsLength} onChange={event => setInstructions(event.target.value)} required />
            <label className="flex items-start gap-2 text-[13px] text-adm-ink-2"><input type="checkbox" className="mt-0.5" checked={sendMessage} onChange={event => setSendMessage(event.target.checked)} />{T.notify}</label>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={busy || !instructions.trim()}>{busy ? T.busy : T.request}</button>
          </fieldset>
        </form>}
        {history && <div className="space-y-3">
          <h3 className="adm-label">{T.history}</h3>
          {history.revisions.length === 0 && <p className="adm-help">{T.empty}</p>}
          {history.revisions.map(revision => <article key={revision.id} className="rounded-lg border border-adm-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{T[revision.status]}</span>
              <time className="text-adm-ink-3" dateTime={revision.createdAt}>{time(revision.createdAt)}</time>
              {revision.status === "pending" && <button type="button" className="adm-btn adm-btn-sm ml-auto" disabled={busy} onClick={() => void cancel(revision.id)}>{T.cancel}</button>}
            </div>
            <p lang="pl" className="mt-2 whitespace-pre-wrap break-words text-[13px]">{revision.instructions}</p>
            {revision.response && <div className="mt-3 border-t border-adm-line pt-3">
              <p className="adm-label">{T.response}{revision.submittedAt && <> · <time dateTime={revision.submittedAt}>{time(revision.submittedAt)}</time></>}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-[13px]">{revision.response.body}</p>
              {revision.response.files.length > 0 && <ul className="mt-2 space-y-1">{revision.response.files.map(file => <li key={file.id}><a className="text-[13px] underline underline-offset-2" href={file.url} target="_blank" rel="noreferrer">{file.name}</a></li>)}</ul>}
            </div>}
          </article>)}
        </div>}
        {error && <p className="text-[13px] text-adm-red" role="alert">{error}</p>}
        <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{T.reload}</button>
      </div>
    </section>
  );
}
