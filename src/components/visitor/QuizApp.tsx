"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { content, QUESTION_KEYS } from "@/config/content";
import { reviewConfig } from "@/config/settings";
import { api, newId, type PublicFile } from "@/lib/api";
import { Lane, type Step } from "./Lane";
import { Backdrop } from "../visual/Backdrop";
import { StepContact } from "./StepContact";
import { StepQuestions } from "./StepQuestions";
import { StepTask } from "./StepTask";
import { VisitorChat } from "./VisitorChat";
import { fromServer, type UploadItem } from "./Uploader";
import { displayPhone, validateContact, type ContactDraft, type ContactErrors } from "./ContactFields";
import { PixelHeading } from "../visual/PixelHeading";

type SessionState = {
  answers: Record<string, string>;
  contact: { name: string; phone: string; telegram: string | null } | null;
  submission: { id: string; submittedAt: string } | null;
  files: PublicFile[];
  limits: { maxFiles: number; maxFileSizeBytes: number; types: string[] };
};

const allAnswered = (a: Record<string, string>) => QUESTION_KEYS.every((k) => Boolean(a[k]));

const IDEM_KEY = "nl_submit_key";
const REVIEW_KEY = "nl_review_draft";
const readReview = () => {
  try {
    return sessionStorage.getItem(REVIEW_KEY) ?? "";
  } catch {
    return "";
  }
};

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
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [contact, setContact] = useState<ContactDraft>({ name: "", phone: "", telegram: "" });
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const [contactSaving, setContactSaving] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Draft survives a reload within the tab.
  const [review, setReviewRaw] = useState(readReview);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const setReview = (v: string) => {
    setReviewRaw(v);
    if (reviewError && v.trim().length >= reviewConfig.minLength) {
      setReviewError(null);
      setSubmitError(null);
    }
    try {
      sessionStorage.setItem(REVIEW_KEY, v);
    } catch {}
  };
  const idem = useRef<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const t = autoTimer;
    return () => clearTimeout(t.current);
  }, []);

  const fetchSession = useCallback(
    () =>
      api<SessionState>("/api/session")
        .then((s) => {
          setState(s);
          setAnswers(s.answers);
          if (s.contact)
            setContact({ name: s.contact.name, phone: displayPhone(s.contact.phone), telegram: s.contact.telegram ?? "" });
          setItems(s.files.map(fromServer));
          // Resume where the visitor left off.
          setStep(s.submission ? 3 : !s.contact ? 0 : allAnswered(s.answers) ? 2 : 1);
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

  const goTo = (next: Step) => {
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
      // The last missing answer just arrived: move on to the task automatically.
      const next = { ...answers, [questionKey]: value };
      if (!allAnswered(answers) && allAnswered(next)) {
        clearTimeout(autoTimer.current);
        autoTimer.current = setTimeout(() => goTo(2), 700);
      }
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

  /** Step 1 "Dalej": validate, save the contact on the server, then show the questions. */
  const saveContact = async () => {
    setContactError(null);
    const errors = validateContact(contact);
    setContactErrors(errors);
    const firstBad = (Object.keys(errors) as (keyof ContactDraft)[]).find((k) => errors[k]);
    if (firstBad) {
      document.getElementById(`contact-${firstBad}`)?.focus();
      return setContactError(content.errors.fixFields);
    }
    setContactSaving(true);
    try {
      await api("/api/contact", { method: "PUT", json: contact });
      goTo(1);
    } catch (err) {
      setContactError((err as Error).message);
    } finally {
      setContactSaving(false);
    }
  };

  /** Step 2 "Dalej" (if the visitor came back and the answers were already complete). */
  const continueFromQuestions = () => {
    if (!allAnswered(answers)) return setAnswerError(content.errors.answerRequired);
    clearTimeout(autoTimer.current);
    goTo(2);
  };

  const submit = async () => {
    setSubmitError(null);
    if (items.some((i) => i.status === "uploading")) return setSubmitError(content.errors.filesPending);
    const ready = items.filter((i) => i.status === "done" && i.serverId);
    if (ready.length === 0) return setSubmitError(content.errors.filesRequired);
    if (review.trim().length < reviewConfig.minLength) {
      setReviewError(content.errors.reviewRequired);
      document.getElementById("review")?.focus();
      return setSubmitError(content.errors.fixFields);
    }
    idem.current ??= readIdem();
    setSubmitting(true);
    try {
      const res = await api<{ submissionId: string; submittedAt: string }>("/api/submit", {
        method: "POST",
        json: { idempotencyKey: idem.current, fileIds: ready.map((i) => i.serverId), review: review.trim() },
      });
      setState((s) => (s ? { ...s, submission: { id: res.submissionId, submittedAt: res.submittedAt } } : s));
      setItems(ready);
      try {
        sessionStorage.removeItem(IDEM_KEY);
        sessionStorage.removeItem(REVIEW_KEY);
      } catch {}
      goTo(3);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh overflow-x-clip">
      <Backdrop />
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <p className="flex items-center gap-2.5">
            <span aria-hidden className="relative grid size-8 place-items-center rounded-full bg-paint/10 ring-1 ring-paint/40">
              <span className="size-3.5 rounded-full border-[3px] border-cyan border-r-transparent" />
            </span>
            <span className="display text-[1.05rem] font-bold">{content.brand.name}</span>
          </p>
          <span className="chip">
            <span className="chip-dot" aria-hidden />
            {content.brand.demoBadge}
          </span>
        </div>
        {/* Mobile progress */}
        <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 md:hidden">
          <Lane step={step} />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 md:grid md:grid-cols-[10rem_1fr] md:gap-14 lg:gap-20 lg:px-10">
        <aside className="hidden md:block">
          <div className="sticky top-28 pt-14">
            <Lane step={step} />
          </div>
        </aside>

        <main ref={heading} className="min-w-0 pt-10 md:pt-14">
          {!state && !loadError && (
            <div aria-busy className="space-y-4">
              <div className="skeleton h-6 w-40 rounded-full" />
              <div className="skeleton h-14 w-3/4 rounded-xl" />
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton mt-10 h-56 rounded-(--radius-tile)" />
            </div>
          )}

          {loadError && (
            <div role="alert" className="glass rounded-(--radius-tile) border-danger/50 p-6">
              <p className="font-semibold text-danger">{loadError}</p>
              <button type="button" className="btn btn-primary mt-4" onClick={load}>
                {content.chat.retry}
              </button>
            </div>
          )}

          {state && step === 0 && (
            <StepContact
              contact={contact}
              errors={contactErrors}
              onChange={onContactChange}
              saving={contactSaving}
              error={contactError}
              onContinue={() => void saveContact()}
            />
          )}

          {state && step === 1 && (
            <StepQuestions
              answers={answers}
              saving={saving}
              error={answerError}
              onAnswer={choose}
              onBack={() => {
                clearTimeout(autoTimer.current);
                goTo(0);
              }}
              onContinue={continueFromQuestions}
            />
          )}

          {state && step === 2 && (
            <StepTask
              items={items}
              setItems={setItems}
              limits={state.limits}
              submitting={submitting}
              error={submitError}
              review={review}
              onReviewChange={setReview}
              reviewError={reviewError}
              onBack={() => goTo(1)}
              onSubmit={submit}
            />
          )}

          {state && step === 3 && (
            <section className="step-enter space-y-10" aria-labelledby="done-title">
              <div>
                <p className="chip pop border-cyan/50 text-cyan" role="status">
                  <span aria-hidden>✓</span> {content.done.status}
                </p>
                <PixelHeading id="done-title" wrapperClassName="mt-5" className="display text-[clamp(2.75rem,7vw,5.5rem)] font-bold">
                  {content.done.title} <span className="accent-text">{content.done.titleAccent}</span>
                </PixelHeading>
                <p className="measure mt-4 text-lg leading-relaxed text-ink-soft">{content.done.body}</p>
              </div>
              <div className="reveal" style={{ "--i": 2 } as React.CSSProperties}>
                <VisitorChat />
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
