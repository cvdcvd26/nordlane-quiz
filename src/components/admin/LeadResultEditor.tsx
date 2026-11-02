"use client";

import Link from "next/link";
import type { LeadStatus } from "@/config/content";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, History, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { leadResultReasons, leadResultsConfig, type LeadResultDetail, type LeadResultState, type LeadResultUpdate } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";
import { useAdminDraftGuard } from "@/lib/admin-draft-guard";
import { api, ApiError } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { ErrorState, StatusBadge } from "./ui";
import "./lead-results.css";

type Draft = Omit<LeadResultUpdate, "expectedVersion">;
const draftFrom = (result: LeadResultState): Draft => ({ reason: result.reason, comment: result.comment, responsibleAdminId: result.responsibleAdminId });
const equalDraft = (a: Draft, b: Draft) => a.reason === b.reason && a.comment.trim() === b.comment.trim() && a.responsibleAdminId === b.responsibleAdminId;

export default function LeadResultEditor({ leadId, currentStatus, refreshRevision = 0, onSaved, onDirtyChange, standalone = true }: { leadId: string; currentStatus?: LeadStatus; refreshRevision?: number; onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void; standalone?: boolean }) {
  const { lang, t } = useAdminI18n();
  const copy = leadResultsCopy[lang];
  const id = useId();
  const [loaded, setLoaded] = useState<{ leadId: string; detail: LeadResultDetail; draft: Draft } | null>(null);
  const [failure, setFailure] = useState<{ leadId: string; forbidden: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<"conflict" | "responsible" | "failed" | "forbidden" | null>(null);
  const [saved, setSaved] = useState(false);
  const saveController = useRef<AbortController | null>(null);
  const loadedForLead = loaded?.leadId === leadId ? loaded : null;
  const detail = loadedForLead?.detail;
  const draft = loadedForLead?.draft;
  const dirty = Boolean(detail && draft && !equalDraft(draft, draftFrom(detail.result)));
  useAdminDraftGuard(`lead-result:${leadId}`, dirty || saving);
  useEffect(() => { onDirtyChange?.(dirty || saving); }, [dirty, saving, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => () => { saveController.current?.abort(); }, [leadId]);

  useEffect(() => {
    const controller = new AbortController();
    void api<LeadResultDetail>(`/api/admin/leads/${encodeURIComponent(leadId)}/result`, { signal: controller.signal })
      .then(detail => {
        if (controller.signal.aborted) return;
        // Refresh a changed status without discarding an owner's unsaved notes.
        // Keep the old metadata version while dirty: a concurrent edit must still
        // fail optimistically instead of silently overwriting another owner tab.
        setLoaded(current => current?.leadId === leadId && !equalDraft(current.draft, draftFrom(current.detail.result))
          ? { ...current, detail: { ...current.detail, status: detail.status } }
          : { leadId, detail, draft: draftFrom(detail.result) });
        setFailure(null);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        const forbidden = error instanceof ApiError && [401, 403].includes(error.status);
        if (forbidden) { saveController.current?.abort(); setLoaded(null); setSaving(false); }
        setFailure({ leadId, forbidden });
      });
    return () => controller.abort();
  }, [leadId, revision, currentStatus, refreshRevision]);

  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setLoaded(current => current?.leadId === leadId ? { ...current, draft: { ...current.draft, ...patch } } : current);
  };
  const reloadLatest = () => {
    if ((dirty || saving) && !window.confirm(copy.discardWarning)) return;
    saveController.current?.abort();
    setLoaded(null);
    setFailure(null);
    setSaveError(null);
    setSaved(false);
    setSaving(false);
    setRevision(current => current + 1);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !draft || !dirty || saving || saveError === "conflict") return;
    const controller = new AbortController();
    saveController.current?.abort();
    saveController.current = controller;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next = await api<LeadResultDetail>(`/api/admin/leads/${encodeURIComponent(leadId)}/result`, {
        method: "PATCH", signal: controller.signal, json: { ...draft, expectedVersion: detail.result.version } satisfies LeadResultUpdate,
      });
      if (controller.signal.aborted) return;
      setLoaded({ leadId, detail: next, draft: draftFrom(next.result) });
      setSaved(true);
      onSaved?.();
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        setLoaded(null);
        setFailure({ leadId, forbidden: true });
        return;
      }
      setSaveError(error instanceof ApiError && error.status === 409 ? "conflict"
        : error instanceof ApiError && error.code === "lead_result_responsible" ? "responsible"
        : error instanceof ApiError && [401, 403].includes(error.status) ? "forbidden" : "failed");
    } finally { if (!controller.signal.aborted) setSaving(false); }
  };
  const formatDate = (value: string) => new Date(value).toLocaleString(t.locale, { timeZone: "Europe/Warsaw", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const responsibleLabel = (value: string | null) => value === null ? copy.unassigned : detail?.responsibleAdmins.find(admin => admin.id === value)?.email ?? copy.unknownAccount;
  const historyState = (state: LeadResultState) => <>
    {state.status ? <StatusBadge status={state.status} /> : <>
      <p><span className={`lres-badge lres-q-${state.qualification}`}>{copy.qualifications[state.qualification]}</span></p>
      <p className="mt-1.5 text-[12px] font-semibold">{copy.closures[state.closure]}</p>
    </>}
    <p className="mt-1 text-[12px] text-adm-ink-2">{copy.reason}: {state.reason ? copy.reasonLabels[state.reason] : copy.noReason}</p>
    <p className="mt-1 break-all text-[12px] text-adm-ink-2">{copy.responsible}: {responsibleLabel(state.responsibleAdminId)}</p>
    <p className="mt-2 whitespace-pre-wrap break-words text-[12px] text-adm-ink-2">{copy.comment}: {state.comment || "—"}</p>
  </>;

  return <section className={`lres lres-editor ${standalone ? "adm-panel mb-4 p-4 sm:p-5" : ""}`} aria-labelledby={`${id}-title`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><ShieldCheck aria-hidden className="size-4 text-adm-accent" /><h2 id={`${id}-title`} className="text-[16px] font-bold">{copy.editorTitle}</h2></div>
        <p className="mt-1.5 text-[13px] text-adm-ink-2">{copy.editorHint}</p>
      </div>
      <span className="lres-private"><LockKeyhole aria-hidden className="size-3" />{copy.internal}</span>
    </div>
    <p className="lres-internal-hint mt-4">{copy.internalHint}</p>
    {failure?.leadId === leadId ? <div className="mt-4"><ErrorState text={failure.forbidden ? copy.forbidden : copy.loadFailed} onRetry={failure.forbidden ? undefined : reloadLatest} /></div>
      : !detail || !draft ? <div className="mt-4 space-y-3" role="status" aria-label={copy.loading}><div className="adm-skeleton h-16" /><div className="adm-skeleton h-32" /></div>
      : <>
        {!detail.hasSavedResult ? <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-adm-ink-2"><Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0" />{copy.noSavedResult}</p> : null}
        <form className="mt-5 space-y-5" onSubmit={event => void save(event)} aria-busy={saving}>
          <div className="rounded-xl border border-adm-line bg-adm-subtle/40 p-4">
            <p className="mb-2 text-[12px] font-semibold">{copy.status}</p>
            <StatusBadge status={currentStatus ?? detail.status} />
            <p className="mt-2 text-[12px] leading-relaxed text-adm-ink-3">{copy.statusHint}</p>
            {currentStatus === undefined ? <Link href={`/admin/leads/${leadId}`} className="mt-3 inline-block text-[12px] font-semibold text-adm-accent underline underline-offset-4">{copy.changeStatus}</Link> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1.5 text-[12px] font-semibold" htmlFor={`${id}-reason`}><span>{copy.reason} <span className="font-normal text-adm-ink-3">({copy.optional})</span></span>
              <select id={`${id}-reason`} className="adm-input" disabled={saving} value={draft.reason ?? ""} onChange={event => change({ reason: event.target.value as Draft["reason"] || null })}>
                <option value="">{copy.noReasonSelected}</option>{leadResultReasons.map(reason => <option key={reason} value={reason}>{copy.reasonLabels[reason]}</option>)}
              </select>
            </label>
            <label className="grid content-start gap-1.5 text-[12px] font-semibold" htmlFor={`${id}-responsible`}>{copy.responsible}
              <select id={`${id}-responsible`} className="adm-input" disabled={saving} value={draft.responsibleAdminId ?? ""} onChange={event => change({ responsibleAdminId: event.target.value || null })} aria-describedby={`${id}-responsible-hint`}>
                <option value="">{copy.unassigned}</option>
                {draft.responsibleAdminId && !detail.responsibleAdmins.some(admin => admin.id === draft.responsibleAdminId) ? <option value={draft.responsibleAdminId} disabled>{copy.unknownAccount}</option> : null}
                {detail.responsibleAdmins.map(admin => <option key={admin.id} value={admin.id}>{admin.email}</option>)}
              </select>
              <span id={`${id}-responsible-hint`} className="text-[11px] leading-relaxed font-normal text-adm-ink-3">{copy.responsibleHint}</span>
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold" htmlFor={`${id}-comment`}>{copy.comment} <span className="font-normal text-adm-ink-3">({copy.optional})</span></label>
            <textarea id={`${id}-comment`} className="adm-input min-h-24 resize-y leading-relaxed" rows={3} maxLength={leadResultsConfig.commentLimit} value={draft.comment} disabled={saving} onChange={event => change({ comment: event.target.value })} aria-describedby={`${id}-comment-hint`} />
            <div className="mt-1.5 flex items-start justify-between gap-3 text-[11.5px] text-adm-ink-3"><p id={`${id}-comment-hint`}>{copy.commentHint}</p><span className="shrink-0 tabular-nums">{draft.comment.length} / {leadResultsConfig.commentLimit}</span></div>
          </div>
          {saveError ? <div role="alert" className="lres-save-error">
            <p>{saveError === "conflict" ? copy.conflict : saveError === "responsible" ? copy.invalidResponsible : saveError === "forbidden" ? copy.forbidden : copy.saveFailed}</p>
            {saveError === "conflict" ? <button className="adm-btn adm-btn-sm mt-3" type="button" disabled={saving} onClick={reloadLatest}>{copy.reloadLatest}</button> : null}
          </div> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-adm-line pt-4">
            <div className="text-[12px] text-adm-ink-3" aria-live="polite">
              {saving ? copy.saving : saved ? <span className="flex items-center gap-1.5 font-semibold text-adm-green"><Check aria-hidden className="size-3.5" />{copy.saved}</span> : dirty ? copy.unsaved : detail.result.updatedAt ? `${copy.lastSaved}: ${formatDate(detail.result.updatedAt)}` : ""}
            </div>
            <button className="adm-btn adm-btn-primary" type="submit" disabled={saving || saveError === "conflict" || !dirty}><Save aria-hidden className="size-3.5" />{saving ? copy.saving : copy.save}</button>
          </div>
        </form>
        <details className="mt-5 border-t border-adm-line pt-4">
          <summary className="flex w-fit cursor-pointer items-center gap-2 text-[12px] font-semibold"><History aria-hidden className="size-3.5" />{copy.history}<span className="text-adm-ink-3">({detail.history.length})</span></summary>
          <p className="mt-2 text-[11.5px] text-adm-ink-3">{copy.historyHint}</p>
          {detail.history.length === 0 ? <p className="mt-3 text-[12px] text-adm-ink-3">{copy.noHistory}</p> : <ol className="mt-3 space-y-3">{detail.history.map(entry => <li key={entry.id} className="rounded-lg border border-adm-line bg-adm-subtle/40 p-3">
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-adm-ink-3"><time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time><span className="break-all">{copy.changedBy}: {entry.actor?.email ?? copy.unknownAccount}</span></p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="min-w-0 border-l-2 border-adm-line-strong pl-3"><p className="mb-2 text-[10px] font-bold tracking-wider text-adm-ink-3">{copy.from}</p>{historyState(entry.previous)}</div><div className="min-w-0 border-l-2 border-adm-accent pl-3"><p className="mb-2 text-[10px] font-bold tracking-wider text-adm-accent">{copy.to}</p>{historyState(entry.next)}</div></div>
          </li>)}</ol>}
        </details>
      </>}
  </section>;
}
