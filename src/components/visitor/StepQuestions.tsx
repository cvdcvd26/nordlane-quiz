"use client";
import { useRef } from "react";
import { content } from "@/config/content";
import { PixelHeading } from "../visual/PixelHeading";

type Props = {
  answers: Record<string, string>;
  saving: string | null;
  error: string | null;
  onAnswer: (questionKey: string, value: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

const delay = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** Step 2: three yes/no questions. */
export function StepQuestions({ answers, saving, error, onAnswer, onBack, onContinue }: Props) {
  const q = content.quiz;
  const questions = q.questions;
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  const remaining = questions.filter((x) => !answers[x.key]).length;
  const done = questions.length - remaining;

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
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const options = questions[qi].options;
    const next = (oi + d + options.length) % options.length;
    groups.current[qi]?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
    onAnswer(questions[qi].key, options[next].value);
  };

  return (
    <section aria-labelledby="q-title">
      <p className="chip reveal" style={delay(0)}>
        <span className="chip-dot" aria-hidden />
        {q.questionsEyebrow}
      </p>
      <PixelHeading id="q-title" wrapperClassName="reveal mt-6" style={delay(1)} className="display text-[clamp(2.75rem,7vw,5.5rem)] font-bold">
        {q.questionsTitle} <span className="accent-text">{q.questionsTitleAccent}</span>
      </PixelHeading>
      <p className="measure reveal mt-5 text-lg leading-relaxed text-ink-soft" style={delay(2)}>
        {q.questionsIntro}
      </p>

      {/* Questions */}
      <div className="glass reveal mt-12 rounded-(--radius-tile) p-5 sm:p-7" style={delay(3)}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate" aria-live="polite">{remaining > 0 ? q.remaining(remaining) : q.saved}</h2>
          <span className="text-sm text-slate tabular-nums" aria-hidden>
            {done}/{questions.length}
          </span>
        </div>
        {/* Thin progress for the three answers */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
          <div
            className="h-full rounded-full bg-paint transition-[width] duration-700 ease-(--ease-lane)"
            style={{ width: `${(done / questions.length) * 100}%` }}
          />
        </div>

        {/* The three questions are a sequence, so they are numbered */}
        <ol className="mt-4 divide-y divide-line">
          {questions.map((question, qi) => {
            const answer = answers[question.key];
            return (
              <li key={question.key} className="grid gap-4 py-6 md:grid-cols-[1fr_minmax(0,20rem)] md:items-center md:gap-8">
                <div className="flex gap-4">
                  <span
                    aria-hidden
                    className={`display grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-all duration-500 ${
                      answer ? "bg-paint text-on-paint" : "border border-line-strong text-ink-soft"
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
                        className="tile flex h-18 items-center justify-center active:scale-[0.98] sm:h-20"
                      >
                        <span className={`display text-[clamp(1.4rem,3.4vw,1.9rem)] font-bold transition-colors ${selected ? "text-cyan" : "text-ink"}`}>
                          {o.label}
                        </span>
                        {selected && (
                          <span aria-hidden className="pop absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-paint text-[0.65rem] text-on-paint">
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
      </div>

      <div className="reveal mt-8 flex flex-wrap items-center gap-4" style={delay(4)}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          <span aria-hidden>←</span> {content.task.back}
        </button>
        <button
          type="button"
          className="btn btn-primary min-w-40"
          onClick={onContinue}
          disabled={remaining > 0 || saving !== null}
        >
          {q.continue} <span aria-hidden className="arrow">→</span>
        </button>
        <span className="text-sm text-slate" aria-live="polite">
          {error && <span className="text-danger">{error}</span>}
        </span>
      </div>
    </section>
  );
}
