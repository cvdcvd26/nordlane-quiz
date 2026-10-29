"use client";
import { LogoMark } from "@/components/ui/LogoMark";
import { useCallback, useEffect, useRef, useState } from "react";
import { content, QUESTION_KEYS } from "@/config/content";
import { reviewConfig } from "@/config/settings";
import type { CandidateOutcome } from "@/config/candidate-outcome";
import { api, newId, type PublicFile } from "@/lib/api";
import { QUIZ_HISTORY_STEP, QUIZ_STEP_PATHS, resolveQuizStep, type QuizProgress } from "@/lib/quiz-steps";
import { Lane, type Step } from "./Lane";
import { Backdrop } from "../visual/Backdrop";
import { HalloweenSeason } from "../visual/HalloweenSeason";
import { StepContact } from "./StepContact";
import { StepQuestions } from "./StepQuestions";
import { StepTaskOverview, StepTaskSubmission } from "./StepTask";
import { VisitorChat } from "./VisitorChat";
import { fromServer, type UploadItem } from "./Uploader";
import { displayPhone, validateContact, type ContactDraft, type ContactErrors } from "./ContactFields";
import { SubmissionConfirmation, SubmissionFilesSummary } from "./SubmissionConfirmation";
import { CandidateOutcomeCard } from "./CandidateOutcomeCard";
import { VisitorTelemetry } from "./VisitorTelemetry";
import { TaskRevisionNotice, TaskRevisionPanel } from "./TaskRevisionPanel";
import type { TaskRevision } from "@/config/task-revisions";

type SessionState = {
  answers: Record<string, string>;
  contact: { name: string; phone: string; telegram: string | null } | null;
  submission: { id: string; submittedAt: string } | null;
  outcome: CandidateOutcome | null;
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
  const [outcome, setOutcome] = useState<CandidateOutcome | null>(null);
  const [activeRevision, setActiveRevision] = useState<TaskRevision | null>(null);
  const [chatUnlocked, setChatUnlocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answersRef = useRef<Record<string, string>>({});
  const answerSaving = useRef(false);
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
  const progress = useRef<QuizProgress | null>(null);
  const navigationRevision = useRef(0);
  useEffect(() => {
    const t = autoTimer;
    return () => clearTimeout(t.current);
  }, []);

  const goTo = useCallback((next: Step, history: "push" | "replace" = "push", moveFocus = true) => {
    if (!progress.current) return;
    clearTimeout(autoTimer.current);
    navigationRevision.current += 1;
    const allowed = resolveQuizStep(QUIZ_STEP_PATHS[next], progress.current, next);
    setStep(allowed);

    const historyState = { [QUIZ_HISTORY_STEP]: allowed };
    const path = QUIZ_STEP_PATHS[allowed];
    if (window.location.pathname !== path) {
      // Next's native History API integration updates the URL without remounting
      // this shared layout, preserving uploads and unsaved form/chat drafts.
      window.history[history === "push" ? "pushState" : "replaceState"](historyState, "", `${path}${window.location.search}`);
    } else {
      window.history.replaceState(historyState, "", window.location.href);
    }

    if (!moveFocus) return;
    requestAnimationFrame(() => {
      heading.current?.querySelector("h1")?.setAttribute("tabindex", "-1");
      (heading.current?.querySelector("h1") as HTMLElement | null)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }, []);

  const fetchSession = useCallback(
    () =>
      api<SessionState>("/api/session")
        .then((s) => {
          setState(s);
          setChatUnlocked(Boolean(s.submission || (s.contact && allAnswered(s.answers))));
          setOutcome(s.outcome);
          setAnswers(s.answers);
          answersRef.current = s.answers;
          if (s.contact)
            setContact({ name: s.contact.name, phone: displayPhone(s.contact.phone), telegram: s.contact.telegram ?? "" });
          setItems(s.files.map(fromServer));
          progress.current = { contactSaved: Boolean(s.contact), questionsComplete: allAnswered(s.answers), submitted: Boolean(s.submission) };
          const requested = resolveQuizStep(window.location.pathname, progress.current, window.history.state?.[QUIZ_HISTORY_STEP]);
          goTo(requested, "replace", false);
        })
        .catch((err: Error) => setLoadError(err.message)),
    [goTo],
  );

  const load = () => {
    setLoadError(null);
    void fetchSession();
  };

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    const onPopState = () => {
      if (!progress.current) return;
      const requested = resolveQuizStep(window.location.pathname, progress.current, window.history.state?.[QUIZ_HISTORY_STEP]);
      goTo(requested, "replace");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [goTo]);

  const choose = async (questionKey: string, value: string) => {
    if (answerSaving.current) return;
    answerSaving.current = true;
    clearTimeout(autoTimer.current);
    const previous = answersRef.current;
    const startedAtNavigation = navigationRevision.current;
    const next = { ...previous, [questionKey]: value };
    setAnswers(next);
    setAnswerError(null);
    setSaving(questionKey);
    try {
      await api("/api/quiz/answer", { method: "PUT", json: { questionKey, answer: value } });
      // The last missing answer just arrived: move on to the task automatically.
      answersRef.current = next;
      if (allAnswered(next)) setChatUnlocked(true);
      if (progress.current) progress.current.questionsComplete = allAnswered(next);
      if (startedAtNavigation === navigationRevision.current && !allAnswered(previous) && allAnswered(next)) {
        clearTimeout(autoTimer.current);
        autoTimer.current = setTimeout(() => goTo(2), 700);
      }
    } catch (err) {
      setAnswers(previous);
      setAnswerError((err as Error).message);
    } finally {
      answerSaving.current = false;
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
      setState((s) => s && { ...s, contact: { ...contact, telegram: contact.telegram || null } });
      if (progress.current) progress.current.contactSaved = true;
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
    if (items.some((i) => i.status === "error")) return setSubmitError(content.task.upload.resolveErrors);
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
      if (progress.current) progress.current.submitted = true;
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
    <>
    <VisitorTelemetry ready={Boolean(state)} step={step} />
    <div className="min-h-dvh overflow-x-clip" data-outcome={outcome?.status}>
      <Backdrop />
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <p className="flex items-center gap-2.5">
            <LogoMark className="grid size-10 shrink-0 place-items-center rounded-xl border border-paint/30 bg-gradient-to-br from-[#133a2b] to-surface-2 shadow-[0_0_20px_#2ee6a014]" />
            <span className="display relative z-10 text-[1.05rem] font-bold">{content.brand.name}</span>
          </p>
        </div>
        {/* Mobile progress */}
        <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 md:hidden">
          <Lane step={step} rejected={Boolean(outcome)} />
        </div>
      </header>
      <HalloweenSeason hidden={!state || Boolean(outcome)} />

      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 md:grid md:grid-cols-[10rem_1fr] md:gap-14 lg:gap-20 lg:px-10">
        <aside className="hidden md:block">
          <div className="sticky top-28 pt-14">
            <Lane step={step} rejected={Boolean(outcome)} />
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

          {state && step === 2 && <StepTaskOverview />}

          {state && step === 3 && (
            <section className="step-enter space-y-6" aria-labelledby="done-title">
              {!outcome && <TaskRevisionNotice revision={activeRevision} />}
              <div aria-live="polite" aria-atomic="true">
                {outcome ? (
                  <CandidateOutcomeCard title={outcome.title} body={outcome.body} as="h1" id="done-title" live={false}>
                    <SubmissionFilesSummary fileCount={items.filter((item) => item.status === "done" && item.serverId).length} muted />
                  </CandidateOutcomeCard>
                ) : (
                  <SubmissionConfirmation fileCount={items.filter((item) => item.status === "done" && item.serverId).length} />
                )}
              </div>
              <TaskRevisionPanel closed={Boolean(outcome)} onRevisionChange={setActiveRevision} />
            </section>
          )}
          {state && chatUnlocked && <div hidden={step < 2 || Boolean(outcome)} className="mt-6">
            <VisitorChat onOutcome={setOutcome} closed={Boolean(outcome)} collapsible={step !== 3} active={step >= 2} />
          </div>}
          {state && step === 2 && <StepTaskSubmission
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
          />}
        </main>
      </div>
    </div>
    </>
  );
}
