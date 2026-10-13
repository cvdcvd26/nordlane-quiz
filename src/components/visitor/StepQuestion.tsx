"use client";
import { useRef } from "react";
import { content } from "@/config/content";
import { ContactFields, type ContactDraft, type ContactErrors } from "./ContactFields";

type Props = {
  contact: ContactDraft;
  contactErrors: ContactErrors;
  onContactChange: (next: ContactDraft, field: keyof ContactDraft) => void;
  continuing: boolean;
  answers: Record<string, string>;
  saving: string | null;
  error: string | null;
  onAnswer: (questionKey: string, value: string) => void;
  onContinue: () => void;
};

export function StepQuestion({ contact, contactErrors, onContactChange, continuing, answers, saving, error, onAnswer, onContinue }: Props) {
  const q = content.quiz;
  const questions = q.questions;
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  const remaining = questions.filter((x) => !answers[x.key]).length;

  const choose = (qi: number, value: string) => {
    const wasEmpty = !answers[questions[qi].key];
    onAnswer(questions[qi].key, value);
    // After a first answer, move to the next unanswered question.
    if (wasEmpty) {
      const next = questions.findIndex((x, i) => i > qi && !answers[x.key]);
      if (next !== -1) {
        const el = groups.current[next];
        el?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
  };

  // Radio group with arrow-key navigation.
  const onKey = (e: React.KeyboardEvent, qi: number, oi: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const options = questions[qi].options;
    const next = (oi + delta + options.length) % options.length;
    groups.current[qi]?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    onAnswer(questions[qi].key, options[next].value);
  };

  return (
    <section aria-labelledby="q-title" className="step-enter">
      <p className="text-sm font-medium text-slate">{q.eyebrow}</p>
      <h1 id="q-title" className="display mt-3 text-[clamp(1.9rem,4.6vw,3.25rem)] font-semibold">
        {q.title}
      </h1>
      <p className="measure mt-4 text-lg leading-relaxed text-ink-soft">{q.description}</p>

      <div className="mt-10 border-t-2 border-line pt-8">
        <ContactFields value={contact} errors={contactErrors} onChange={onContactChange} />
      </div>

      {/* The three questions are a sequence, so they are numbered */}
      <h2 className="mt-8 text-lg font-semibold">{q.questionsTitle}</h2>
      <ol className="mt-2 space-y-8">
        {questions.map((question, qi) => {
          const answer = answers[question.key];
          return (
            <li key={question.key} className="grid gap-4 border-t-2 border-line pt-6 md:grid-cols-[1fr_minmax(0,22rem)] md:items-center md:gap-8">
              <div className="flex gap-4">
                <span
                  aria-hidden
                  className={`display grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors ${
                    answer ? "bg-ink text-paint" : "bg-paint text-ink"
                  }`}
                >
                  {answer ? "✓" : qi + 1}
                </span>
                <h3 id={`${question.key}-text`} className="pt-0.5 text-lg leading-snug font-semibold md:text-xl">
                  {question.text}
                </h3>
              </div>

              <div
                ref={(el) => {
                  groups.current[qi] = el;
                }}
                role="radiogroup"
                aria-labelledby={`${question.key}-text`}
                aria-busy={saving === question.key}
                className="grid grid-cols-2 gap-3"
              >
                {question.options.map((o, oi) => {
                  const selected = answer === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected || (!answer && oi === 0) ? 0 : -1}
                      onClick={() => choose(qi, o.value)}
                      onKeyDown={(e) => onKey(e, qi, oi)}
                      className={[
                        "relative flex h-20 items-center justify-center rounded-(--radius-tile) border-2 transition-[background-color,border-color,transform] duration-200 sm:h-24",
                        "active:scale-[0.985]",
                        selected ? "border-ink bg-ink text-surface" : "border-line bg-surface hover:-translate-y-0.5 hover:border-ink",
                      ].join(" ")}
                    >
                      <span className="display text-[clamp(1.6rem,4vw,2.25rem)] font-bold">{o.label}</span>
                      {selected && (
                        <span aria-hidden className="pop absolute top-2.5 right-2.5 grid size-6 place-items-center rounded-full bg-paint text-xs text-ink">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t-2 border-line pt-6">
        <button type="button" className="btn btn-primary" onClick={onContinue} disabled={remaining > 0 || saving !== null || continuing} aria-busy={continuing}>
          {q.continue}
        </button>
        <span className="text-sm text-slate" aria-live="polite">
          {error ? <span className="text-danger">{error}</span> : remaining > 0 ? q.remaining(remaining) : saving ? "" : q.saved}
        </span>
      </div>
    </section>
  );
}
