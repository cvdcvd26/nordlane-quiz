"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { content, LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { uploadConfig } from "@/config/settings";
import { api, formatBytes, formatTime, newId, type ChatMessage, type PublicFile } from "@/lib/api";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatPhone, nationalDigits } from "@/lib/contact";

type Details = {
  lead: { id: number; status: LeadStatus; createdAt: string; updatedAt: string; messageCount: number; lastMessageAt: string | null };
  contact: { name: string; phone: string; telegram: string | null } | null;
  answers: { question: string; answer: string; updatedAt: string | null }[];
  submission: {
    id: string;
    submittedAt: string;
    files: PublicFile[];
    autoMessage: { status: string; scheduledFor: string; sentAt: string | null; attempts: number; lastError: string | null } | null;
  } | null;
  messages: ChatMessage[];
  notes: { id: string; body: string; createdAt: string }[];
};

const autoStatus = content.admin.lead.autoStatus;

export default function LeadPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />}>
      <Lead />
    </Suspense>
  );
}

function Lead() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Details>(`/api/admin/leads/${id}`)
      .then((r) => {
        setD(r);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !d)
    return (
      <p role="alert" className="rounded-(--radius-field) bg-danger-soft p-4 text-danger">
        {error} <Link href="/admin" className="underline">{content.admin.lead.toList}</Link>
      </p>
    );
  if (!d) return <div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />;

  const setStatus = async (status: string) => {
    setBusy(true);
    try {
      setD(await api<Details>(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } }));
    } catch (e) {
      setError((e as Error).message);
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
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
      setSendError((e as Error).message);
      throw e;
    }
  };

  return (
    <div>
      <Link href="/admin" className="text-sm text-slate underline hover:text-ink">
        {content.admin.lead.back}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold">{content.admin.lead.title(d.lead.id)}</h1>
        <StatusBadge status={d.lead.status} />
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-slate">{content.admin.lead.status}</span>
          <select className="field w-auto py-2" value={d.lead.status} disabled={busy} onChange={(e) => setStatus(e.target.value)}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {content.admin.statuses[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-slate">
        {content.admin.lead.meta(formatTime(d.lead.createdAt), formatTime(d.lead.updatedAt), d.lead.messageCount)}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_22rem]">
        {/* Conversation */}
        <section aria-labelledby="thread" className="self-start rounded-(--radius-tile) border-2 border-line bg-surface">
          <h2 id="thread" className="border-b-2 border-line px-5 py-4 font-semibold">
            {content.admin.lead.thread}
          </h2>
          <div className="max-h-[60vh] min-h-64 overflow-y-auto bg-paper/50 px-4 py-5">
            <MessageList messages={d.messages} viewer="admin" emptyText={content.admin.lead.noMessages} />
          </div>
          <div className="border-t-2 border-line p-3">
            <Composer
              onSend={reply}
              uploadUrl={`/api/admin/leads/${id}/uploads`}
              accept={[...uploadConfig.adminAttachmentTypes]}
              attachmentsEnabled
              maxFiles={uploadConfig.maxFilesPerMessage}
              placeholder={content.admin.lead.replyPlaceholder}
            />
            {sendError && <p className="mt-2 text-sm text-danger">{sendError}</p>}
          </div>
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="font-semibold">{content.admin.lead.contact}</h2>
            {d.contact ? (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate">{content.admin.lead.contactName}</dt>
                <dd className="font-semibold">{d.contact.name}</dd>
                <dt className="text-slate">{content.admin.lead.contactPhone}</dt>
                <dd>
                  <a href={`tel:${d.contact.phone}`} className="font-semibold underline-offset-2 hover:underline">
                    {formatPhone(nationalDigits(d.contact.phone))}
                  </a>
                </dd>
                <dt className="text-slate">{content.admin.lead.contactTelegram}</dt>
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
            <h2 className="font-semibold">{content.admin.lead.answers}</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {d.answers.map((a) => (
                <div key={a.question}>
                  <dt className="text-slate">{a.question}</dt>
                  <dd className="mt-0.5 font-semibold">{a.answer}</dd>
                </div>
              ))}
            </dl>
          </section>

          {d.submission && (
            <section>
              <h2 className="font-semibold">{content.admin.lead.submission}</h2>
              <p className="mt-1 text-sm text-slate">{content.admin.lead.submittedAt(formatTime(d.submission.submittedAt))}</p>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {d.submission.files.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border-2 border-line hover:border-ink">
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
                  {content.admin.lead.autoMessage}: {autoStatus[d.submission.autoMessage.status] ?? d.submission.autoMessage.status}
                  {d.submission.autoMessage.sentAt
                    ? ` ${formatTime(d.submission.autoMessage.sentAt)}`
                    : ` ${content.admin.lead.autoAt(formatTime(d.submission.autoMessage.scheduledFor))}`}
                  {d.submission.autoMessage.lastError && <span className="block text-danger">{d.submission.autoMessage.lastError}</span>}
                </p>
              )}
            </section>
          )}

          <section>
            <h2 className="font-semibold">{content.admin.lead.notes}</h2>
            <p className="mt-1 text-xs text-slate">{content.admin.lead.notesHint}</p>
            <form onSubmit={addNote} className="mt-3">
              <label className="sr-only" htmlFor="note">
                {content.admin.lead.newNote}
              </label>
              <textarea id="note" className="field min-h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder={content.admin.lead.newNote} maxLength={5000} />
              <button type="submit" className="btn btn-ghost mt-2 h-10 min-h-0 bg-surface text-sm" disabled={busy || !note.trim()}>
                {content.admin.lead.addNote}
              </button>
            </form>
            <ul className="mt-4 space-y-3">
              {d.notes.map((n) => (
                <li key={n.id} className="border-l-[3px] border-paint pl-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <time className="text-xs text-slate" dateTime={n.createdAt}>
                    {formatTime(n.createdAt)}
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
