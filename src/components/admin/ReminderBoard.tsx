"use client";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Bell, Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { reminderCopy, type ReminderCopy } from "@/config/admin-reminders";
import { api, ApiError } from "@/lib/api";
import { useAdminDraftGuard } from "@/lib/admin-draft-guard";
import { clampReminderOffset, formatReminderTime, REMINDER_BODY_LIMIT, REMINDER_PAGE_SIZE, reminderCreateSchema, toWarsawInput, warsawTimeCandidates, type LeadReminder, type ReminderFilter, type ReminderList } from "@/lib/reminders";
import { ACTIVITY_EVENT } from "./ActivityNotifier";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";
import { ErrorState } from "./ui";

export const REMINDERS_EVENT = "nl-admin-reminders";

function ReminderForm({ reminder, busy, error, T, onSave, onCancel, draftScope }: {
  reminder?: LeadReminder; busy: boolean; error: string | null; T: ReminderCopy;
  draftScope: string;
  onSave: (value: { body: string; dueAt: string }) => void; onCancel: () => void;
}) {
  const id = useId();
  const [initial] = useState(() => ({
    body: reminder?.body ?? "", date: toWarsawInput(reminder?.dueAt ?? new Date(Date.now() + 3600000)), occurrence: reminder?.dueAt ?? "",
  }));
  const [body, setBody] = useState(initial.body);
  const [date, setDate] = useState(initial.date);
  const [occurrence, setOccurrence] = useState(initial.occurrence);
  useAdminDraftGuard(draftScope, body !== initial.body || date !== initial.date || occurrence !== initial.occurrence);
  const [validation, setValidation] = useState<string | null>(null);
  const candidates = warsawTimeCandidates(date);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!candidates.length) { setValidation(T.invalidTime); return; }
    const dueAt = candidates.length === 1 ? candidates[0] : candidates.find(value => value === occurrence);
    if (!dueAt) { setValidation(T.repeatedTime); return; }
    const value = reminderCreateSchema.safeParse({ body, dueAt });
    if (!value.success) { setValidation(T.invalid); return; }
    setValidation(null); onSave(value.data);
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-adm-line-strong bg-adm-subtle/40 p-3">
      <fieldset disabled={busy} className="space-y-3">
        <div>
          <label htmlFor={`${id}-body`} className="adm-label">{T.body}</label>
          <textarea id={`${id}-body`} value={body} onChange={event => setBody(event.target.value)} maxLength={REMINDER_BODY_LIMIT} required className="adm-input mt-1.5 min-h-20" autoFocus />
        </div>
        <div>
          <label htmlFor={`${id}-date`} className="adm-label">{T.deadline}</label>
          <input id={`${id}-date`} type="datetime-local" value={date} onChange={event => { setDate(event.target.value); setOccurrence(""); }} min="2000-01-01T00:00" max="2100-12-31T23:59" required aria-describedby={`${id}-zone`} className="adm-input mt-1.5 max-w-xs" />
          <p id={`${id}-zone`} className="adm-help mt-1.5">{T.zone}</p>
        </div>
        {candidates.length > 1 && <div>
          <label htmlFor={`${id}-occurrence`} className="adm-label">{T.repeatedTime}</label>
          <select id={`${id}-occurrence`} value={candidates.includes(occurrence) ? occurrence : ""} onChange={event => setOccurrence(event.target.value)} required className="adm-input mt-1.5 max-w-sm">
            <option value="">{T.chooseTime}</option>
            {candidates.map((value, index) => <option key={value} value={value}>{index === 0 ? T.earlier : T.later}</option>)}
          </select>
        </div>}
      </fieldset>
      {(validation || error) && <p role="alert" className="text-[13px] text-adm-red">{validation || error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={onCancel}>{T.cancel}</button>
        <button type="submit" className="adm-btn adm-btn-sm adm-btn-primary" disabled={busy}>{busy ? T.saving : T.save}</button>
      </div>
    </form>
  );
}

export default function ReminderBoard({ leadId }: { leadId?: number }) {
  const { lang, t, err: tErr } = useAdminI18n();
  const T = reminderCopy[lang];
  const [filter, setFilter] = useState<ReminderFilter>(leadId ? "all" : "due");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ReminderList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeadReminder | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const boardId = useId();
  const listUrl = leadId ? `/api/admin/leads/${leadId}/reminders` : "/api/admin/reminders";

  useEffect(() => {
    const refresh = (event?: Event) => {
      if (document.hidden || (event instanceof CustomEvent && event.detail?.source === boardId)) return;
      setReload(value => value + 1);
    };
    window.addEventListener(ACTIVITY_EVENT, refresh);
    window.addEventListener(REMINDERS_EVENT, refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, refresh); window.removeEventListener(REMINDERS_EVENT, refresh);
      document.removeEventListener("visibilitychange", refresh); clearInterval(timer);
    };
  }, [boardId]);
  useEffect(() => {
    const controller = new AbortController();
    api<ReminderList>(`${listUrl}?filter=${filter}&offset=${offset}`, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        const validOffset = clampReminderOffset(offset, value.total);
        setLoadError(null);
        if (validOffset !== offset) { setOffset(validOffset); setData(null); return; }
        setData(value);
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof ApiError && error.code === "reminder_failed" ? T.error : tErr(error)); });
    return () => controller.abort();
  }, [filter, offset, reload, listUrl, tErr, T.error]);

  const changed = () => {
    setConfirmDelete(null);
    // A completed user action refreshes this board even if the tab became hidden mid-request.
    setReload(value => value + 1);
    window.dispatchEvent(new CustomEvent(REMINDERS_EVENT, { detail: { source: boardId } }));
  };
  const errorText = (error: unknown) => error instanceof ApiError && error.code === "reminder_changed" ? T.changed
    : error instanceof ApiError && error.code === "validation" ? T.invalid
      : error instanceof ApiError && error.code === "reminder_failed" ? T.error : tErr(error);
  const save = async (value: { body: string; dueAt: string }) => {
    if (busy || !editing) return;
    setBusy(true); setFormError(null);
    try {
      if (editing === "new") {
        if (!leadId) return;
        await api(`/api/admin/leads/${leadId}/reminders`, { method: "POST", json: value });
      } else {
        await api(`/api/admin/leads/${editing.leadId}/reminders/${editing.id}`, { method: "PATCH", json: { action: "edit", revision: editing.revision, ...value } });
      }
      setEditing(null); changed(); toast({ kind: "success", title: T.saved });
    } catch (error) { setFormError(errorText(error)); }
    finally { setBusy(false); }
  };
  const act = async (reminder: LeadReminder, action: "complete" | "reopen" | "delete") => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/admin/leads/${reminder.leadId}/reminders/${reminder.id}`, {
        method: action === "delete" ? "DELETE" : "PATCH",
        json: { ...(action === "delete" ? {} : { action }), revision: reminder.revision },
      });
      changed(); toast({ kind: "success", title: action === "delete" ? T.deleted : T.saved });
    } catch (error) { toast({ kind: "error", title: errorText(error) }); changed(); }
    finally { setBusy(false); }
  };
  const filters: ReminderFilter[] = leadId ? ["all", "due", "upcoming", "done"] : ["due", "upcoming", "done"];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-adm-line px-4 py-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label={T.title}>
          {filters.map(value => <button type="button" key={value} aria-pressed={filter === value} className={`adm-btn adm-btn-sm ${filter === value ? "adm-btn-primary" : ""}`} onClick={() => { setFilter(value); setOffset(0); setData(null); }}>
            {T[value]}{data ? ` (${data.counts[value]})` : ""}
          </button>)}
        </div>
        <button type="button" onClick={() => setReload(value => value + 1)} className="adm-btn adm-btn-sm ml-auto"><RotateCcw aria-hidden className="size-3.5" />{T.reload}</button>
        {leadId && <button type="button" className="adm-btn adm-btn-sm" disabled={busy || editing !== null} onClick={() => { setEditing("new"); setFormError(null); }}><Plus aria-hidden className="size-3.5" />{T.add}</button>}
      </div>
      {editing && <div className="p-4"><ReminderForm key={editing === "new" ? "new" : editing.id} reminder={editing === "new" ? undefined : editing} draftScope={`lead:${editing === "new" ? leadId : editing.leadId}`} busy={busy} error={formError} T={T} onSave={save} onCancel={() => setEditing(null)} /></div>}
      {loadError && <div className="p-4"><ErrorState text={loadError} onRetry={() => setReload(value => value + 1)} /></div>}
      {!data && !loadError && <p role="status" className="adm-help p-4">{T.loading}</p>}
      {data && <>
        {!data.reminders.length && <p className="adm-help px-4 py-6">{T.empty}</p>}
        <ul className="divide-y divide-adm-line">
          {data.reminders.map(reminder => <li key={reminder.id} className="p-4">
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-adm-ink-3">
                <span className={`inline-flex items-center gap-1.5 ${!reminder.completedAt && reminder.dueAt <= data.now ? "font-semibold text-adm-red" : ""}`}>
                  <Bell aria-hidden className="size-3.5" /><time dateTime={reminder.dueAt}>{formatReminderTime(reminder.dueAt, t.locale)}</time>
                  {!reminder.completedAt && reminder.dueAt <= data.now ? <span>· {T.overdue}</span> : null}
                </span>
                {reminder.completedAt && <span className="font-medium text-adm-green">{T.done}</span>}
                {!leadId && <Link className="font-semibold text-adm-accent hover:underline" href={`/admin/leads/${reminder.leadId}`} aria-label={`${T.openLead}: #${reminder.leadId}`}>#{reminder.leadId}{reminder.name ? ` · ${reminder.name}` : ""}</Link>}
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px] text-adm-ink">{reminder.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className="adm-btn adm-btn-sm" onClick={() => void act(reminder, reminder.completedAt ? "reopen" : "complete")}>
                  {reminder.completedAt ? <RotateCcw aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />}{reminder.completedAt ? T.reopen : T.complete}
                </button>
                <button type="button" disabled={busy || editing !== null} className="adm-btn adm-btn-sm" onClick={() => { setEditing(reminder); setFormError(null); }}><Pencil aria-hidden className="size-3.5" />{T.edit}</button>
                {confirmDelete === reminder.id ? <>
                  <button type="button" disabled={busy} className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => void act(reminder, "delete")}>{T.confirmRemove}</button>
                  <button type="button" disabled={busy} className="adm-btn adm-btn-sm" onClick={() => setConfirmDelete(null)}>{T.cancel}</button>
                </> : <button type="button" disabled={busy} className="adm-btn adm-btn-sm text-adm-ink-3" onClick={() => setConfirmDelete(reminder.id)}><Trash2 aria-hidden className="size-3.5" />{T.remove}</button>}
              </div>
            </>
          </li>)}
        </ul>
        {data.total > REMINDER_PAGE_SIZE && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-adm-line px-4 py-3">
          <span className="adm-help mr-auto">{T.page(offset + 1, Math.min(offset + REMINDER_PAGE_SIZE, data.total), data.total)}</span>
          <button type="button" className="adm-btn adm-btn-sm" disabled={offset === 0 || busy} onClick={() => { setOffset(Math.max(0, offset - REMINDER_PAGE_SIZE)); setData(null); }}>{T.previous}</button>
          <button type="button" className="adm-btn adm-btn-sm" disabled={offset + REMINDER_PAGE_SIZE >= data.total || busy} onClick={() => { setOffset(offset + REMINDER_PAGE_SIZE); setData(null); }}>{T.next}</button>
        </div>}
      </>}
    </div>
  );
}
