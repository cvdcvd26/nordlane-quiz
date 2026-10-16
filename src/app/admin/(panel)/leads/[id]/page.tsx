"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Trash2 } from "lucide-react";
import { LEAD_STATUSES, QUESTION_KEYS, type LeadStatus } from "@/config/content";
import { uploadConfig } from "@/config/settings";
import { api, formatBytes, newId, type ChatMessage, type PublicFile } from "@/lib/api";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { AdmStars, ErrorState, NEXT_STATUS, StageStepper, STATUS_TONE, StatusBadge, TestimonialBadge, type TestimonialStatus } from "@/components/admin/ui";
import { toast } from "@/components/admin/toast";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { useAdminI18n } from "@/components/admin/i18n";

type Details = {
  lead: { id: number; status: LeadStatus; createdAt: string; updatedAt: string; messageCount: number; lastMessageAt: string | null; stage: string; answered: number };
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
  siteReview: {
    requestedAt: string | null;
    testimonial: { id: string; name: string; rating: number; body: string; status: TestimonialStatus; createdAt: string } | null;
  } | null;
};

export default function LeadPage() {
  return (
    <Suspense fallback={<div className="adm-skeleton h-64" aria-busy />}>
      <Lead />
    </Suspense>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="border-b border-adm-line px-4 py-4 last:border-0">
      <h2 id={id} className="adm-section-title">
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Lead() {
  const { t, time, err: tErr } = useAdminI18n();
  const T = t.ui.lead;
  const W = t.ui.workflow;
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
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 8000);
    window.addEventListener(ACTIVITY_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(ACTIVITY_EVENT, load);
    };
  }, [load]);

  if (error && !d)
    return (
      <div className="space-y-4">
        <Link href="/admin" className="text-[13px] text-adm-ink-2 hover:text-adm-ink">
          {T.back}
        </Link>
        <ErrorState text={error} onRetry={load} />
      </div>
    );
  if (!d)
    return (
      <div className="space-y-4" aria-busy aria-label={t.ui.common.loading}>
        <div className="adm-skeleton h-6 w-56" />
        <div className="adm-skeleton h-28 w-full" />
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="adm-skeleton h-80" />
          <div className="adm-skeleton h-80" />
        </div>
      </div>
    );

  const setStatus = async (status: LeadStatus) => {
    if (status === d.lead.status) return;
    setBusy(true);
    try {
      setD(await api<Details>(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } }));
      toast({ kind: "success", title: W.statusChanged(d.lead.id, t.ui.statuses[status]) });
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
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
      toast({ kind: "error", title: tErr(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/admin/leads/${id}`, { method: "DELETE" });
      toast({ kind: "success", title: t.ui.list.deleted(1) });
      router.replace("/admin");
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
      setDeleting(false);
    }
  };

  const requestReview = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/leads/${id}/testimonial-request`, { method: "POST" });
      toast({ kind: "success", title: t.ui.testimonials.requestedToast });
      load();
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
    } finally {
      setBusy(false);
    }
  };

  const moderate = async (status: TestimonialStatus) => {
    const tm = d.siteReview?.testimonial;
    if (!tm) return;
    setBusy(true);
    try {
      await api(`/api/admin/testimonials/${tm.id}`, { method: "PATCH", json: { status } });
      toast({ kind: "success", title: t.ui.testimonials.changed(t.ui.testimonials.statuses[status]) });
      load();
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
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
      setSendError(tErr(e));
      throw e;
    }
  };

  const next = NEXT_STATUS[d.lead.status];
  const name = d.contact?.name;

  return (
    <div>
      <nav aria-label="breadcrumb" className="mb-3 flex items-center gap-1 text-[13px] text-adm-ink-3">
        <Link href="/admin" className="hover:text-adm-ink">
          {t.ui.nav.leads}
        </Link>
        <ChevronRight aria-hidden className="size-3.5" />
        <span className="text-adm-ink-2">#{d.lead.id}</span>
      </nav>

      <div className="mb-5 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-[20px] leading-tight font-bold tracking-[-0.01em]">{T.title(d.lead.id)}</h1>
            {name && <span className="text-[16px] font-semibold text-adm-ink-2">{name}</span>}
            <StatusBadge status={d.lead.status} />
          </div>
          <p className="mt-1 text-[13px] text-adm-ink-3">{T.meta(time(d.lead.createdAt), time(d.lead.updatedAt), d.lead.messageCount)}</p>
        </div>
        <button type="button" className="adm-btn adm-btn-danger" onClick={() => setConfirmDelete(true)} disabled={deleting}>
          <Trash2 aria-hidden className="size-3.5" />
          {T.delete}
        </button>
      </div>

      {confirmDelete && (
        <div role="alertdialog" aria-labelledby="del-q" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[#efc2bd] bg-adm-red-bg px-4 py-3 text-[13.5px]">
          <p id="del-q" className="flex-1 text-adm-red">
            {T.confirmDelete(d.lead.id)}
          </p>
          <div className="flex gap-2">
            <button type="button" className="adm-btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t.ui.list.cancel}
            </button>
            <button type="button" className="adm-btn adm-btn-danger-solid" onClick={() => void remove()} disabled={deleting}>
              {deleting ? T.deleting : t.ui.list.confirmYes}
            </button>
          </div>
        </div>
      )}

      {/* Workflow: where the visitor is, and what the team does with the lead */}
      <div className="adm-panel mb-4 grid divide-y divide-adm-line lg:grid-cols-[1.25fr_1fr] lg:divide-x lg:divide-y-0">
        <section aria-labelledby="stage-title" className="p-4">
          <h2 id="stage-title" className="adm-section-title">
            {W.stageTitle}
          </h2>
          <div className="mt-3">
            <StageStepper stage={d.lead.stage} answered={d.lead.answered} total={QUESTION_KEYS.length} />
          </div>
          <p className="adm-help mt-3">{W.stageHint}</p>
        </section>

        <section aria-labelledby="status-title" className="p-4">
          <h2 id="status-title" className="adm-section-title">
            {W.statusTitle}
          </h2>
          <div role="radiogroup" aria-labelledby="status-title" className="mt-3 flex flex-wrap gap-1.5">
            {LEAD_STATUSES.map((s) => {
              const active = s === d.lead.status;
              const tone = STATUS_TONE[s];
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() => void setStatus(s)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${
                    active ? `${tone.bg} ${tone.text} border-current` : "border-adm-line-strong bg-adm-surface text-adm-ink-2 hover:bg-adm-subtle hover:text-adm-ink"
                  }`}
                >
                  <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
                  {t.ui.statuses[s]}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {next && (
              <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void setStatus(next)}>
                {W.next(t.ui.statuses[next])}
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
            )}
            <p className="adm-help">{W.statusHint}</p>
          </div>
        </section>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        {/* Conversation */}
        <section aria-labelledby="thread" className="adm-panel">
          <h2 id="thread" className="adm-section-title border-b border-adm-line px-4 py-3">
            {T.thread}
          </h2>
          <div className="max-h-[60vh] min-h-72 overflow-y-auto px-4 py-4">
            <MessageList
              messages={d.messages}
              viewer="admin"
              text={t.chat}
              locale={t.locale}
              appearance="admin"
              emptyText={d.submission ? T.noMessages : T.noSubmissionYet}
            />
          </div>
          <div className="border-t border-adm-line p-3">
            <Composer
              onSend={reply}
              uploadUrl={`/api/admin/leads/${id}/uploads`}
              accept={[...uploadConfig.adminAttachmentTypes]}
              attachmentsEnabled
              maxFiles={uploadConfig.maxFilesPerMessage}
              placeholder={T.replyPlaceholder}
              text={t.chat}
              translateError={tErr}
              appearance="admin"
            />
            {sendError && <p className="mt-2 text-[13px] text-adm-red">{sendError}</p>}
          </div>
        </section>

        {/* Details */}
        <aside className="adm-panel">
          <Section title={T.contact} id="contact-title">
            {d.contact ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
                <dt className="text-adm-ink-3">{T.contactName}</dt>
                <dd className="font-semibold">{d.contact.name}</dd>
                <dt className="text-adm-ink-3">{T.contactPhone}</dt>
                <dd>
                  <a href={`tel:${d.contact.phone}`} className="font-semibold text-adm-accent tabular-nums hover:underline">
                    {formatPhone(nationalDigits(d.contact.phone))}
                  </a>
                </dd>
                <dt className="text-adm-ink-3">{T.contactTelegram}</dt>
                <dd>
                  {d.contact.telegram ? (
                    <a
                      href={`https://t.me/${d.contact.telegram.slice(1)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-adm-accent hover:underline"
                    >
                      {d.contact.telegram}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </dl>
            ) : (
              <p className="text-[13px] text-adm-ink-3">—</p>
            )}
          </Section>

          <Section title={T.review} id="review-title">
            {d.submission?.review ? (
              <blockquote className="border-l-2 border-adm-accent pl-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">{d.submission.review}</blockquote>
            ) : (
              <p className="text-[13px] text-adm-ink-3">{d.submission ? T.noReview : T.noSubmissionYet}</p>
            )}
          </Section>

          <Section title={t.ui.testimonials.leadTitle} id="site-review-title">
            {d.siteReview?.testimonial ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <AdmStars value={d.siteReview.testimonial.rating} />
                  <TestimonialBadge status={d.siteReview.testimonial.status} />
                </div>
                <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{d.siteReview.testimonial.body}</p>
                <p className="text-[12.5px] text-adm-ink-3">
                  {d.siteReview.testimonial.name} · {time(d.siteReview.testimonial.createdAt)}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {d.siteReview.testimonial.status !== "published" && (
                    <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" disabled={busy} onClick={() => void moderate("published")}>
                      {t.ui.testimonials.publish}
                    </button>
                  )}
                  {d.siteReview.testimonial.status === "published" && (
                    <button type="button" className="adm-btn adm-btn-sm" disabled={busy} onClick={() => void moderate("pending")}>
                      {t.ui.testimonials.unpublish}
                    </button>
                  )}
                  {d.siteReview.testimonial.status === "pending" && (
                    <button type="button" className="adm-btn adm-btn-danger adm-btn-sm" disabled={busy} onClick={() => void moderate("rejected")}>
                      {t.ui.testimonials.reject}
                    </button>
                  )}
                </div>
              </div>
            ) : d.siteReview?.requestedAt ? (
              <p className="text-[13px] text-adm-ink-2">{t.ui.testimonials.requested(time(d.siteReview.requestedAt))}</p>
            ) : (
              <>
                <p className="adm-help">{t.ui.testimonials.notRequested}</p>
                <button type="button" className="adm-btn mt-2.5" disabled={busy || !d.submission} onClick={() => void requestReview()}>
                  {t.ui.testimonials.request}
                </button>
              </>
            )}
          </Section>

          <Section title={T.answers} id="answers-title">
            <dl className="space-y-2.5 text-[13.5px]">
              {d.answers.map((a) => (
                <div key={a.question}>
                  <dt className="text-[12.5px] text-adm-ink-3">{a.question}</dt>
                  <dd className="font-semibold">{a.value ? (t.ui.answers[a.value] ?? a.value) : "—"}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {d.submission && (
            <Section title={T.submission} id="task-title">
              <p className="text-[12.5px] text-adm-ink-3">{T.submittedAt(time(d.submission.submittedAt))}</p>
              <ul className="mt-2.5 grid grid-cols-2 gap-2">
                {d.submission.files.map((f) => (
                  <li key={f.id}>
                    <a href={f.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-md border border-adm-line hover:border-adm-accent">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private file */}
                      <img src={f.url} alt={f.name} className="aspect-[4/3] w-full bg-adm-subtle object-cover" loading="lazy" />
                      <span className="block truncate px-2 py-1 text-[12px] text-adm-ink-2">
                        {f.name} · {formatBytes(f.size)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              {d.submission.autoMessage && (
                <p className="mt-2.5 text-[12.5px] text-adm-ink-3">
                  {T.autoMessage}: {T.autoStatus[d.submission.autoMessage.status] ?? d.submission.autoMessage.status}
                  {d.submission.autoMessage.sentAt
                    ? ` ${time(d.submission.autoMessage.sentAt)}`
                    : ` ${T.autoAt(time(d.submission.autoMessage.scheduledFor))}`}
                  {d.submission.autoMessage.lastError && <span className="block text-adm-red">{d.submission.autoMessage.lastError}</span>}
                </p>
              )}
            </Section>
          )}

          <Section title={T.notes} id="notes-title">
            <p className="adm-help -mt-1">{T.notesHint}</p>
            <form onSubmit={addNote} className="mt-2">
              <label className="sr-only" htmlFor="note">
                {T.newNote}
              </label>
              <textarea id="note" className="adm-input min-h-16" value={note} onChange={(e) => setNote(e.target.value)} placeholder={T.newNote} maxLength={5000} />
              <button type="submit" className="adm-btn mt-2" disabled={busy || !note.trim()}>
                {T.addNote}
              </button>
            </form>
            {d.notes.length > 0 && (
              <ul className="mt-3 space-y-2.5">
                {d.notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-adm-subtle px-3 py-2 text-[13.5px]">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <time className="text-[12px] text-adm-ink-3" dateTime={n.createdAt}>
                      {time(n.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
