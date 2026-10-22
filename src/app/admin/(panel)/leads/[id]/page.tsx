"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Trash2 } from "lucide-react";
import { LEAD_STATUSES, QUESTION_KEYS, type LeadStatus } from "@/config/content";
import { api, formatBytes, newId, type ChatMessage, type PublicFile, type MessagePage } from "@/lib/api";
import { mergeMessages } from "@/lib/chat";
import { MessageList } from "@/components/chat/MessageList";
import { ManagerAvatar } from "@/components/chat/ManagerAvatar";
import type { ManagerProfile } from "@/config/managers";
import { AdminChatComposer } from "@/components/admin/AdminChatComposer";
import { inboxCopy } from "@/config/admin-inbox";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { AdmStars, ErrorState, NEXT_STATUS, StageStepper, STATUS_TONE, StatusBadge, TestimonialBadge, type TestimonialStatus } from "@/components/admin/ui";
import { toast } from "@/components/admin/toast";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { useAdminI18n } from "@/components/admin/i18n";
import { CandidateOutcomeEditor } from "@/components/admin/CandidateOutcomeEditor";
import type { CandidateOutcome } from "@/config/candidate-outcome";

type Details = {
  lead: { manager: ManagerProfile; outcome: CandidateOutcome | null; id: number; status: LeadStatus; createdAt: string; updatedAt: string; messageCount: number; lastMessageAt: string | null; stage: string; answered: number; needsReply: boolean; replyWaitingSince: string | null };
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
  hasEarlierMessages: boolean;
  oldestMessageCursor: string | null;
  notes: { id: string; body: string; createdAt: string }[];
  siteReview: {
    requestedAt: string | null;
    testimonial: { id: string; name: string; rating: number; body: string; status: TestimonialStatus; createdAt: string } | null;
  } | null;
};

export default function LeadPage() {
  return (
    <Suspense fallback={<div className="adm-skeleton h-64" aria-busy />}>
      <LeadRoute />
    </Suspense>
  );
}

function LeadRoute() {
  const { id } = useParams<{ id: string }>();
  // A route change must discard the previous lead's draft, history and request state.
  return <Lead key={id} id={id} />;
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

function Lead({ id }: { id: string }) {
  const { lang, t, time, err: tErr } = useAdminI18n();
  const T = t.ui.lead;
  const W = t.ui.workflow;
  const [d, setD] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const replyKey = useRef<{ signature: string; id: string } | null>(null);
  const loadVersion = useRef(0);
  const [history, setHistory] = useState<{ leadId: string; messages: ChatMessage[]; before: string | null } | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);


  const load = useCallback(() => {
    const version = ++loadVersion.current;
    api<Details>(`/api/admin/leads/${id}`)
      .then((r) => {
        if (version !== loadVersion.current) return;
        setD(r);
        setError(null);
      })
      .catch((e) => { if (version === loadVersion.current) setError(tErr(e)); });
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
    ++loadVersion.current;
    try {
      const details = await api<Details>(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } });
      ++loadVersion.current;
      setD(details);
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

  const updateOutcome = async (action: "publish" | "retract", body?: string) => {
    setBusy(true);
    ++loadVersion.current;
    try {
      const details = await api<Details>(`/api/admin/leads/${id}/outcome`, {
        method: "POST",
        json: action === "publish" ? { action, body } : { action },
      });
      ++loadVersion.current;
      setD(details);
      toast({ kind: "success", title: action === "publish" ? t.ui.candidateOutcome.saved : t.ui.candidateOutcome.retracted });
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
    const signature = JSON.stringify({ body, files: files.map((f) => f.id) });
    if (replyKey.current?.signature !== signature) replyKey.current = { signature, id: newId() };
    try {
      const { messages } = await api<{ messages: ChatMessage[] }>(`/api/admin/leads/${id}/messages`, {
        method: "POST",
        json: { clientMessageId: replyKey.current.id, body, fileIds: files.map((f) => f.id) },
      });
      replyKey.current = null;
      setD((prev) => prev && { ...prev, messages });
      window.dispatchEvent(new Event(ACTIVITY_EVENT));
    } catch (e) {
      setSendError(tErr(e));
      throw e;
    }
  };

  const currentHistory = history?.leadId === id ? history : null;
  const before = currentHistory ? currentHistory.before : d.hasEarlierMessages ? d.oldestMessageCursor : null;
  const loadEarlier = async () => {
    if (!before || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await api<MessagePage>(`/api/admin/leads/${id}/messages?before=${encodeURIComponent(before)}`);
      setHistory((prev) => ({ leadId: id,
        messages: mergeMessages(prev?.leadId === id ? prev.messages : [], page.messages),
        before: page.hasMore ? page.previousCursor : null }));
    } catch (e) { toast({ kind: "error", title: tErr(e) }); }
    finally { setLoadingEarlier(false); }
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
          <div className="mt-3 flex items-center gap-2.5">
            <ManagerAvatar manager={d.lead.manager} size={36} />
            <div>
              <p className="text-[11px] text-adm-ink-3">{T.manager}</p>
              <p className="text-[13px] font-semibold">{d.lead.manager.name}</p>
            </div>
          </div>
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
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${
                    active ? `${tone.active} shadow-sm` : `${tone.bg} ${tone.text} ${tone.border} hover:brightness-95`
                  }`}
                >
                  {active ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : <span aria-hidden className={`size-2 rounded-full ${tone.dot}`} />}
                  {t.ui.statuses[s]}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {next && (
              <button type="button" className={`adm-btn ${STATUS_TONE[next].active}`} disabled={busy} onClick={() => void setStatus(next)}>
                {W.next(t.ui.statuses[next])}
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
            )}
            <p className="adm-help">{W.statusHint}</p>
          </div>
          {d.lead.status === "rejected" && !d.submission && <p className="adm-help mt-2">{t.ui.candidateOutcome.requiresSubmission}</p>}
        </section>
      </div>

      {d.lead.status === "rejected" && d.submission && (
        <CandidateOutcomeEditor
          key={d.lead.outcome?.publishedAt ?? "unpublished"}
          outcome={d.lead.outcome}
          disabled={busy}
          onPublish={(body) => updateOutcome("publish", body)}
          onRetract={() => updateOutcome("retract")}
        />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        {/* Conversation */}
        <section aria-labelledby="thread" className="adm-panel">
          <h2 id="thread" className="adm-section-title border-b border-adm-line px-4 py-3">
            {T.thread}
            {d.lead.needsReply && <span className="ml-2 rounded-full bg-adm-amber-bg px-2 py-1 text-[11px] text-adm-amber">{inboxCopy[lang].needsReply}</span>}
          </h2>
          <div className="max-h-[60vh] min-h-72 overflow-y-auto px-4 py-4">
            {before && <button type="button" className="adm-btn mb-4" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{t.chat.loadEarlier}</button>}
            <MessageList
              messages={mergeMessages(currentHistory?.messages ?? [], d.messages)}
              viewer="admin"
              text={t.chat}
              locale={t.locale}
              appearance="admin"
              manager={d.lead.manager}
              emptyText={d.submission ? T.noMessages : T.noSubmissionYet}
            />
          </div>
          <div className="border-t border-adm-line p-3">
            <AdminChatComposer leadId={id} onSend={reply} />
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

          {d.siteReview?.testimonial && (
            <Section title={t.ui.testimonials.leadTitle} id="site-review-title">
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
            </Section>
          )}

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
