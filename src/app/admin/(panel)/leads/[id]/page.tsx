"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { uploadConfig } from "@/config/settings";
import { api, formatBytes, newId, type ChatMessage, type PublicFile } from "@/lib/api";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { StageBadge } from "@/components/admin/StageBadge";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { useAdminI18n } from "@/components/admin/i18n";

type Details = {
  lead: { id: number; status: LeadStatus; createdAt: string; updatedAt: string; messageCount: number; lastMessageAt: string | null; stage: string };
  contact: { name: string; phone: string; telegram: string | null } | null;
  answers: { question: string; answer: string; value: string | null; updatedAt: string | null }[];
  submission: {
    id: string;
    submittedAt: string;
    review: string | null;
    files: PublicFile[];
    autoMessage: { status: string; scheduledFor: string; sentAt: string | null; attempts: number; lastError: string | null } | null;
  } | null;
  messages: ChatMessage[];
  notes: { id: string; body: string; createdAt: string }[];
};


export default function LeadPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />}>
      <Lead />
    </Suspense>
  );
}

function Lead() {
  const { t, time, err: tErr } = useAdminI18n();
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const load = useCallback(() => {
    api<Details>(`/api/admin/leads/${id}`)
      .then((r) => {
        setD(r);
        setError(null);
      })
      .catch((e) => setError(tErr(e)));
  }, [id, tErr]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 8000);
    window.addEventListener(ACTIVITY_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(ACTIVITY_EVENT, load);
    };
  }, [load]);

  if (error && !d)
    return (
      <p role="alert" className="rounded-(--radius-field) bg-danger-soft p-4 text-danger">
        {error} <Link href="/admin" className="underline">{t.ui.lead.toList}</Link>
      </p>
    );
  if (!d) return <div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />;

  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      setD(await api<Details>(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } }));
    } catch (e) {
      setError(tErr(e));
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      const { note: n } = await api<{ note: Details["notes"][number] }>(`/api/admin/leads/${id}/notes`, { method: "POST", json: { body: note } });
      setD((prev) => prev && { ...prev, notes: [n, ...prev.notes] });
      setNote("");
    } catch (err) {
      setError(tErr(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/admin/leads/${id}`, { method: "DELETE" });
      router.replace("/admin");
    } catch (e) {
      setError(tErr(e));
      setDeleting(false);
    }
  };

  const reply = async (body: string, files: PublicFile[]) => {
    setSendError(null);
    try {
      const { messages } = await api<{ messages: ChatMessage[] }>(`/api/admin/leads/${id}/messages`, {
        method: "POST",
        json: { clientMessageId: newId(), body, fileIds: files.map((f) => f.id) },
      });
      setD((prev) => prev && { ...prev, messages });
    } catch (e) {
      setSendError(tErr(e));
      throw e;
    }
  };

  return (
    <div>
      <Link href="/admin" className="text-sm text-slate underline hover:text-ink">
        {t.ui.lead.back}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">{t.ui.lead.title(d.lead.id)}</h1>
        <StatusBadge status={d.lead.status} />
        <StageBadge stage={d.lead.stage} />
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-slate">{t.ui.lead.status}</span>
          <select className="field w-auto py-2" value={d.lead.status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.ui.statuses[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn h-10 min-h-0 border border-danger/60 px-4 text-sm text-danger hover:bg-danger-soft"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
        >
          {t.ui.lead.delete}
        </button>
      </div>
      {confirmDelete && (
        <div role="alertdialog" aria-labelledby="del-q" className="pop mt-4 flex flex-wrap items-center gap-3 rounded-(--radius-field) border border-danger/40 bg-danger-soft px-4 py-3 text-sm">
          <p id="del-q" className="flex-1">
            {t.ui.lead.confirmDelete(d.lead.id)}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost h-9 min-h-0 px-4 text-sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t.ui.list.cancel}
            </button>
            <button type="button" className="btn h-9 min-h-0 bg-danger px-4 text-sm text-paper hover:brightness-110" onClick={() => void remove()} disabled={deleting}>
              {deleting ? t.ui.lead.deleting : t.ui.list.confirmYes}
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-sm text-slate">
        {t.ui.lead.meta(time(d.lead.createdAt), time(d.lead.updatedAt), d.lead.messageCount)}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        {/* Conversation */}
        <section aria-labelledby="thread" className="self-start rounded-(--radius-tile) glass">
          <h2 id="thread" className="border-b border-line px-5 py-4 font-semibold">
            {t.ui.lead.thread}
          </h2>
          <div className="max-h-[60vh] min-h-64 overflow-y-auto bg-black/20 px-4 py-5">
            <MessageList
              messages={d.messages}
              viewer="admin"
              text={t.chat}
              locale={t.locale}
              emptyText={d.submission ? t.ui.lead.noMessages : t.ui.lead.noSubmissionYet}
            />
          </div>
          <div className="border-t border-line p-3">
            <Composer
              onSend={reply}
              uploadUrl={`/api/admin/leads/${id}/uploads`}
              accept={[...uploadConfig.adminAttachmentTypes]}
              attachmentsEnabled
              maxFiles={uploadConfig.maxFilesPerMessage}
              placeholder={t.ui.lead.replyPlaceholder}
              text={t.chat}
              translateError={tErr}
            />
            {sendError && <p className="mt-2 text-sm text-danger">{sendError}</p>}
          </div>
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="font-semibold">{t.ui.lead.contact}</h2>
            {d.contact ? (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate">{t.ui.lead.contactName}</dt>
                <dd className="font-semibold">{d.contact.name}</dd>
                <dt className="text-slate">{t.ui.lead.contactPhone}</dt>
                <dd>
                  <a href={`tel:${d.contact.phone}`} className="font-semibold underline-offset-2 hover:underline">
                    {formatPhone(nationalDigits(d.contact.phone))}
                  </a>
                </dd>
                <dt className="text-slate">{t.ui.lead.contactTelegram}</dt>
                <dd>
                  {d.contact.telegram ? (
                    <a
                      href={`https://t.me/${d.contact.telegram.slice(1)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold underline-offset-2 hover:underline"
                    >
                      {d.contact.telegram}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate">—</p>
            )}
          </section>

          <section>
            <h2 className="font-semibold">{t.ui.lead.answers}</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {d.answers.map((a) => (
                <div key={a.question}>
                  <dt className="text-slate">{a.question}</dt>
                  <dd className="mt-0.5 font-semibold">{a.value ? (t.ui.answers[a.value] ?? a.value) : "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          {d.submission && (
            <section>
              <h2 className="font-semibold">{t.ui.lead.review}</h2>
              {d.submission.review ? (
                <blockquote className="mt-3 rounded-(--radius-field) border border-line bg-surface-2 p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  {d.submission.review}
                </blockquote>
              ) : (
                <p className="mt-2 text-sm text-slate">{t.ui.lead.noReview}</p>
              )}
            </section>
          )}

          {d.submission && (
            <section>
              <h2 className="font-semibold">{t.ui.lead.submission}</h2>
              <p className="mt-1 text-sm text-slate">{t.ui.lead.submittedAt(time(d.submission.submittedAt))}</p>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {d.submission.files.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-line hover:border-paint/60">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private file */}
                      <img src={f.url} alt={f.name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                      <span className="block truncate px-2 py-1 text-xs">
                        {f.name} · {formatBytes(f.size)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              {d.submission.autoMessage && (
                <p className="mt-3 text-xs text-slate">
                  {t.ui.lead.autoMessage}: {t.ui.lead.autoStatus[d.submission.autoMessage.status] ?? d.submission.autoMessage.status}
                  {d.submission.autoMessage.sentAt
                    ? ` ${time(d.submission.autoMessage.sentAt)}`
                    : ` ${t.ui.lead.autoAt(time(d.submission.autoMessage.scheduledFor))}`}
                  {d.submission.autoMessage.lastError && <span className="block text-danger">{d.submission.autoMessage.lastError}</span>}
                </p>
              )}
            </section>
          )}

          <section>
            <h2 className="font-semibold">{t.ui.lead.notes}</h2>
            <p className="mt-1 text-xs text-slate">{t.ui.lead.notesHint}</p>
            <form onSubmit={addNote} className="mt-3">
              <label className="sr-only" htmlFor="note">
                {t.ui.lead.newNote}
              </label>
              <textarea id="note" className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.ui.lead.newNote} maxLength={5000} />
              <button type="submit" className="btn btn-ghost mt-2 h-10 min-h-0 text-sm" disabled={busy || !note.trim()}>
                {t.ui.lead.addNote}
              </button>
            </form>
            <ul className="mt-4 space-y-3">
              {d.notes.map((n) => (
                <li key={n.id} className="border-l-[3px] border-paint pl-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <time className="text-xs text-slate" dateTime={n.createdAt}>
                    {time(n.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
