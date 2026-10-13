"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { content, QUESTION_KEYS } from "@/config/content";
import { api, newId, type PublicFile } from "@/lib/api";
import { Lane } from "./Lane";
import { StepQuestion } from "./StepQuestion";
import { StepTask } from "./StepTask";
import { VisitorChat } from "./VisitorChat";
import { fromServer, type UploadItem } from "./Uploader";
import { displayPhone, validateContact, type ContactDraft, type ContactErrors } from "./ContactFields";

type SessionState = {
  answers: Record<string, string>;
  contact: { name: string; phone: string; telegram: string | null } | null;
  submission: { id: string; submittedAt: string } | null;
  files: PublicFile[];
  limits: { maxFiles: number; maxFileSizeBytes: number; types: string[] };
};

const allAnswered = (a: Record<string, string>) => QUESTION_KEYS.every((k) => Boolean(a[k]));

const IDEM_KEY = "nl_submit_key";
const readIdem = () => {
  try {
    const existing = sessionStorage.getItem(IDEM_KEY);
    if (existing) return existing;
    const k = newId();
    sessionStorage.setItem(IDEM_KEY, k);
    return k;
  } catch {
    return newId();
  }
};

export function QuizApp() {
  const [state, setState] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactDraft>({ name: "", phone: "", telegram: "" });
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const [continuing, setContinuing] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const idem = useRef<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);

  const fetchSession = useCallback(
    () =>
      api<SessionState>("/api/session")
        .then((s) => {
          setState(s);
          setAnswers(s.answers);
          if (s.contact)
            setContact({ name: s.contact.name, phone: displayPhone(s.contact.phone), telegram: s.contact.telegram ?? "" });
          setItems(s.files.map(fromServer));
          setStep(s.submission ? 2 : s.contact && allAnswered(s.answers) ? 1 : 0);
        })
        .catch((err: Error) => setLoadError(err.message)),
    [],
  );

  const load = () => {
    setLoadError(null);
    void fetchSession();
  };

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const goTo = (next: 0 | 1 | 2) => {
    setStep(next);
    // Move focus to the new step for keyboard and screen-reader users.
    requestAnimationFrame(() => {
      heading.current?.querySelector("h1")?.setAttribute("tabindex", "-1");
      (heading.current?.querySelector("h1") as HTMLElement | null)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };

  const choose = async (questionKey: string, value: string) => {
    const prev = answers[questionKey];
    setAnswers((a) => ({ ...a, [questionKey]: value }));
    setAnswerError(null);
    setSaving(questionKey);
    try {
      await api("/api/quiz/answer", { method: "PUT", json: { questionKey, answer: value } });
    } catch (err) {
      setAnswers((a) => {
        const next = { ...a };
        if (prev) next[questionKey] = prev;
        else delete next[questionKey];
        return next;
      });
      setAnswerError((err as Error).message);
    } finally {
      setSaving((s) => (s === questionKey ? null : s));
    }
  };

  const onContactChange = (next: ContactDraft, field: keyof ContactDraft) => {
    setContact(next);
    // Clear the field's error as soon as it becomes valid.
    if (contactErrors[field] && !validateContact(next)[field]) setContactErrors((er) => ({ ...er, [field]: undefined }));
  };

  /** "Dalej" on the first screen: validate, save the contact on the server, then move on. */
  const continueFromIntro = async () => {
    setAnswerError(null);
    const errors = validateContact(contact);
    setContactErrors(errors);
    const firstBad = (Object.keys(errors) as (keyof ContactDraft)[]).find((k) => errors[k]);
    if (firstBad) {
      document.getElementById(`contact-${firstBad}`)?.focus();
      return setAnswerError(content.errors.fixFields);
    }
    if (!allAnswered(answers)) return setAnswerError(content.errors.answerRequired);
    setContinuing(true);
    try {
      await api("/api/contact", { method: "PUT", json: contact });
      goTo(1);
    } catch (err) {
      setAnswerError((err as Error).message);
    } finally {
      setContinuing(false);
    }
  };

  const submit = async () => {
    setSubmitError(null);
    if (items.some((i) => i.status === "uploading")) return setSubmitError(content.errors.filesPending);
    const ready = items.filter((i) => i.status === "done" && i.serverId);
    if (ready.length === 0) return setSubmitError(content.errors.filesRequired);
    idem.current ??= readIdem();
    setSubmitting(true);
    try {
      const res = await api<{ submissionId: string; submittedAt: string }>("/api/submit", {
        method: "POST",
        json: { idempotencyKey: idem.current, fileIds: ready.map((i) => i.serverId) },
      });
      setState((s) => (s ? { ...s, submission: { id: res.submissionId, submittedAt: res.submittedAt } } : s));
      setItems(ready);
      try {
        sessionStorage.removeItem(IDEM_KEY);
      } catch {}
      goTo(2);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto min-h-dvh max-w-6xl px-4 pb-16 sm:px-6 md:grid md:grid-cols-[11rem_1fr] md:gap-14 lg:gap-20 lg:px-10">
      <aside className="sticky top-0 z-20 -mx-4 mb-8 bg-paper/90 px-4 pt-5 pb-4 backdrop-blur sm:-mx-6 sm:px-6 md:static md:mx-0 md:mb-0 md:bg-transparent md:px-0 md:pt-10 md:backdrop-blur-none">
        <div className="mb-5 flex items-center justify-between md:mb-14 md:block">
          <p className="display text-base font-bold tracking-tight">{content.brand.name}</p>
          <p className="rounded-lg border-[1.5px] border-line-strong px-2.5 py-1 text-[0.7rem] leading-snug text-slate md:mt-3 md:inline-block">
            {content.brand.demoBadge}
          </p>
        </div>
        <Lane step={step} />
      </aside>

      <main ref={heading} className="min-w-0 md:pt-10">
        {!state && !loadError && (
          <div aria-busy className="space-y-4">
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-12 w-3/4 rounded-lg" />
            <div className="skeleton h-5 w-2/3 rounded" />
            <div className="mt-10 grid grid-cols-2 gap-4">
              <div className="skeleton h-44 rounded-(--radius-tile)" />
              <div className="skeleton h-44 rounded-(--radius-tile)" />
            </div>
          </div>
        )}

        {loadError && (
          <div role="alert" className="rounded-(--radius-tile) border-2 border-danger bg-danger-soft p-6">
            <p className="font-semibold">{loadError}</p>
            <button type="button" className="btn btn-primary mt-4" onClick={load}>
              {content.chat.retry}
            </button>
          </div>
        )}

        {state && step === 0 && (
          <StepQuestion
            contact={contact}
            contactErrors={contactErrors}
            onContactChange={onContactChange}
            continuing={continuing}
            answers={answers}
            saving={saving}
            error={answerError}
            onAnswer={choose}
            onContinue={continueFromIntro}
          />
        )}

        {state && step === 1 && (
          <StepTask
            items={items}
            setItems={setItems}
            limits={state.limits}
            submitting={submitting}
            error={submitError}
            onBack={() => goTo(0)}
            onSubmit={submit}
          />
        )}

        {state && step === 2 && (
          <section className="step-enter space-y-10" aria-labelledby="done-title">
            <div>
              <p className="pop inline-flex items-center gap-2 rounded-full bg-paint px-3.5 py-1.5 text-sm font-semibold" role="status">
                <span aria-hidden>✓</span> {content.done.status}
              </p>
              <h1 id="done-title" className="display mt-5 text-[clamp(1.9rem,4.6vw,3.25rem)] font-semibold">
                {content.done.title}
              </h1>
              <p className="measure mt-4 text-lg leading-relaxed text-ink-soft">{content.done.body}</p>
            </div>
            <VisitorChat />
          </section>
        )}
      </main>
    </div>
  );
}
