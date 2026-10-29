"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Ban, CheckCircle2, Clock3, MessageSquareText, Paperclip, Reply } from "lucide-react";
import { revisionConfig, revisionCopy, type TaskRevision } from "@/config/task-revisions";
import { api, ApiError, newId, type PublicFile } from "@/lib/api";
import { useAdminDraftGuard } from "@/lib/admin-draft-guard";
import { useAdminI18n } from "./i18n";

type RevisionHistory = {
  hasSubmission: boolean;
  closed: boolean;
  revisions: (TaskRevision & { response: { body: string; files: PublicFile[] } | null })[];
};

export function RevisionHistoryCard({ revision, copy: T, time, busy, onCancel }: {
  revision: RevisionHistory["revisions"][number];
  copy: typeof revisionCopy.pl;
  time: (iso: string) => string;
  busy: boolean;
  onCancel: (revisionId: string) => void;
}) {
  const cancelled = revision.status === "cancelled";
  const StatusIcon = revision.status === "pending" ? Clock3 : cancelled ? Ban : CheckCircle2;
  const statusTone = revision.status === "pending" ? "bg-adm-amber-bg text-adm-amber"
    : cancelled ? "bg-adm-subtle text-adm-ink-2" : "bg-adm-green-bg text-adm-green";
  const requestTone = cancelled ? "border-adm-line-strong bg-adm-subtle/60" : "border-adm-amber/40 bg-adm-amber-bg/50";

  return (
    <article className="min-w-0 rounded-xl border border-adm-line bg-adm-surface p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone}`}>
          <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {T[revision.status]}
        </span>
        {revision.status === "pending" && <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={() => onCancel(revision.id)}>{T.cancel}</button>}
      </div>
      <section aria-labelledby={`revision-request-${revision.id}`} className={`min-w-0 rounded-lg border border-l-[3px] p-3 ${requestTone}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 id={`revision-request-${revision.id}`} className={`flex items-center gap-2 text-[12px] font-semibold ${cancelled ? "text-adm-ink-2" : "text-adm-amber"}`}>
            <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" />
            {T.ourRequest}
          </h4>
          <time className="text-[11px] tabular-nums text-adm-ink-3" dateTime={revision.createdAt}>{time(revision.createdAt)}</time>
        </div>
        <p lang="pl" className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-adm-ink [overflow-wrap:anywhere]">{revision.instructions}</p>
      </section>
      {revision.response && <section aria-labelledby={`revision-response-${revision.id}`} className="relative ml-3 mt-3 min-w-0 rounded-lg border border-adm-green/30 border-l-[3px] border-l-adm-green bg-adm-green-bg/60 p-3 sm:ml-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 id={`revision-response-${revision.id}`} className="flex items-center gap-2 text-[12px] font-semibold text-adm-green">
            <Reply className="h-4 w-4 shrink-0" aria-hidden="true" />
            {T.response}
          </h4>
          {revision.submittedAt && <time className="text-[11px] tabular-nums text-adm-ink-3" dateTime={revision.submittedAt}>{time(revision.submittedAt)}</time>}
        </div>
        {revision.response.body && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-adm-ink [overflow-wrap:anywhere]">{revision.response.body}</p>}
        {revision.response.files.length > 0 && <ul aria-label={T.attachments} className="mt-3 flex min-w-0 flex-wrap gap-2">
          {revision.response.files.map(file => <li key={file.id} className="min-w-0 max-w-full">
            <a className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-adm-green/25 bg-adm-surface/70 px-2.5 py-1.5 text-[12px] font-medium text-adm-green underline decoration-current/40 underline-offset-2 hover:decoration-current" href={file.url} target="_blank" rel="noopener noreferrer">
              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{file.name}</span>
            </a>
          </li>)}
        </ul>}
      </section>}
    </article>
  );
}

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
          {history.revisions.map(revision => <RevisionHistoryCard key={revision.id} revision={revision} copy={T} time={time} busy={busy} onCancel={revisionId => void cancel(revisionId)} />)}
        </div>}
        {error && <p className="text-[13px] text-adm-red" role="alert">{error}</p>}
        <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={() => setReload(value => value + 1)}>{T.reload}</button>
      </div>
    </section>
  );
}
