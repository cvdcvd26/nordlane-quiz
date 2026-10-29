"use client";
import { ArrowDown, ChevronDown } from "lucide-react";
import { content } from "@/config/content";
import { reviewConfig } from "@/config/settings";
import { Uploader, type UploadItem } from "./Uploader";
import { Reveal } from "../visual/Reveal";
import { PixelHeading } from "../visual/PixelHeading";

type Props = {
  items: UploadItem[];
  setItems: (fn: (prev: UploadItem[]) => UploadItem[]) => void;
  limits: { maxFiles: number; maxFileSizeBytes: number; types: string[] };
  submitting: boolean;
  error: string | null;
  review: string;
  onReviewChange: (v: string) => void;
  reviewError: string | null;
  onBack: () => void;
  onSubmit: () => void;
};

const delay = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function StepTaskOverview() {
  const t = content.task;
  return (
    <section aria-labelledby="about-title">
      {/* 1. About the company — the first thing after the questions */}
      <div>
        <div>
          <p className="chip reveal" style={delay(0)}>
            <span className="chip-dot" aria-hidden />
            {t.about.eyebrow}
          </p>
          <PixelHeading id="about-title" wrapperClassName="reveal mt-6" style={delay(1)} className="display text-[clamp(2.75rem,7vw,5.5rem)] font-bold">
            {t.about.title} <span className="accent-text">{t.about.titleAccent}</span>
          </PixelHeading>
          <div className="measure reveal mt-5 space-y-4 text-lg leading-relaxed text-ink-soft" style={delay(2)}>
            <p>{t.about.body}</p>
            <p>{t.about.vision}</p>
          </div>
        </div>
      </div>

      <Reveal className="glass mt-8 rounded-(--radius-tile) p-5 sm:p-7">
        <h2 className="text-sm font-semibold text-cyan">{t.about.verificationTitle}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          {t.about.identifiers.map((item) => (
            <div key={item.label}>
              <dt className="text-xs font-semibold tracking-wider text-slate">{item.label}</dt>
              <dd className="display mt-1 text-lg font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 border-t border-line pt-4 text-sm text-ink-soft">
          {t.about.website.label}: <a href={t.about.website.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan underline underline-offset-4">{t.about.website.title} <span aria-hidden>↗</span></a>
        </p>
      </Reveal>

      <Reveal className="mt-6 space-y-3">
        <details className="group glass overflow-hidden rounded-(--radius-tile)">
          <summary className="flex cursor-pointer list-none items-center gap-4 p-5 transition-colors hover:bg-paint/5 sm:p-6 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="display block text-xl font-bold sm:text-2xl">{t.about.responsibilitiesTitle}</span>
              <span className="mt-2 block text-sm leading-relaxed text-ink-soft">{t.about.responsibilitiesSummary}</span>
            </span>
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-paint/25 bg-paint/10 text-cyan">
              <ChevronDown className="size-5 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
            </span>
          </summary>
          <div className="border-t border-line p-5 sm:p-6">
            <ul className="space-y-4">
              {t.about.responsibilities.map((item) => (
                <li key={item} className="flex items-start gap-3 leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-paint/15 text-xs font-bold text-cyan">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-line pt-5 text-sm leading-relaxed text-ink-soft">
              <p>{t.about.onboarding}</p>
              <p className="mt-2 font-bold text-cyan">{t.about.paidFromDayOne}</p>
            </div>
          </div>
        </details>

        <details className="group glass overflow-hidden rounded-(--radius-tile)">
          <summary className="flex cursor-pointer list-none items-center gap-4 p-5 transition-colors hover:bg-paint/5 sm:p-6 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="display block text-xl font-bold sm:text-2xl">{t.about.termsTitle}</span>
              <span className="mt-2 block text-sm leading-relaxed text-cyan">{t.about.termsSummary}</span>
            </span>
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-paint/25 bg-paint/10 text-cyan">
              <ChevronDown className="size-5 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
            </span>
          </summary>
          <div className="border-t border-line p-5 sm:p-6">
            <p className="text-lg font-semibold">{t.about.contract}</p>
            <p className="mt-5 text-sm text-ink-soft">{t.about.benefitsTitle}</p>
            <ul className="mt-4 space-y-4">
              {t.about.benefits.map((item) => (
                <li key={item.title} className="flex items-start gap-3 leading-relaxed text-ink-soft">
                  <span aria-hidden className="text-xl">{item.symbol}</span>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 rounded-xl border border-paint/25 bg-paint/10 p-4 text-sm leading-relaxed font-semibold">{t.about.nextContract}</p>
          </div>
        </details>
      </Reveal>

      <Reveal className="mt-8 flex flex-col items-center text-center">
        <span aria-hidden className="mb-4 h-8 w-px bg-gradient-to-b from-transparent to-paint/60" />
        <a
          href="#task-assignment"
          className="group inline-flex max-w-full items-center gap-3 rounded-full border border-paint/35 bg-paint/10 py-2 pr-5 pl-2 font-semibold text-ink transition-colors hover:border-paint/70 hover:bg-paint/15"
          onClick={(event) => {
            const target = document.getElementById("task-assignment");
            if (!target) return;
            event.preventDefault();
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paint text-on-paint">
            <ArrowDown aria-hidden className="size-5 transition-transform motion-safe:group-hover:translate-y-0.5" />
          </span>
          {t.assignment.jump}
        </a>
        <p className="mt-2 text-xs text-ink-soft sm:text-sm">{t.assignment.jumpHint}</p>
      </Reveal>

      {/* 2. The task */}
      <Reveal className="glass mt-8 rounded-(--radius-tile) p-5 sm:p-8">
        <div className="grid gap-8 md:grid-cols-[1fr_minmax(0,17rem)]">
          <div>
            <h2 id="task-assignment" tabIndex={-1} className="display scroll-mt-40 text-2xl font-bold md:scroll-mt-24 sm:text-3xl">{t.assignment.title}</h2>
            <p className="measure mt-3 leading-relaxed text-ink-soft">{t.assignment.body}</p>

            <h3 className="mt-8 text-sm font-bold text-slate">{t.instructions.title}</h3>
            {/* A real sequence, so numbered, joined by a lit line */}
            <ol className="relative mt-4 space-y-5 before:absolute before:top-4 before:bottom-4 before:left-4 before:w-px before:bg-gradient-to-b before:from-cyan/60 before:to-transparent">
              {t.instructions.steps.map((step, i) => (
                <li key={step.text} className="relative flex gap-4">
                  <span className="display z-10 grid size-8 shrink-0 place-items-center rounded-full border border-cyan/50 bg-paper text-sm font-bold text-cyan">
                    {i + 1}
                  </span>
                  <div className="measure min-w-0 flex-1 pt-1 leading-relaxed text-ink-soft">
                    <p className={i === 0 ? "font-semibold text-ink" : undefined}>{step.text}</p>
                    {step.links.length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                        {step.links.map((link) => (
                          <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-paint/30 bg-paint/5 px-4 py-3 transition-colors hover:border-paint/60 hover:bg-paint/10">
                            <span className="block text-sm font-semibold text-ink">{link.label}</span>
                            <span className="mt-0.5 block text-sm text-cyan">{link.store} <span aria-hidden>↗</span></span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* PDF */}
          <div className="card-hover self-start rounded-(--radius-tile) border border-line-strong bg-gradient-to-b from-paint/15 to-surface-2 p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid h-12 w-10 shrink-0 place-items-center rounded-lg bg-paint text-[0.65rem] font-extrabold text-on-paint">
                PDF
              </span>
              <div className="min-w-0">
                <p className="font-bold">{t.pdf.title}</p>
                <p className="mt-1 text-xs leading-relaxed break-all text-ink-soft">{t.pdf.fileName}</p>
                <p className="mt-1.5 text-xs text-slate">{t.pdf.meta}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <a href={t.pdf.url} target="_blank" rel="noopener" className="btn btn-primary h-10 min-h-0 flex-1 px-4 text-sm">
                {t.pdf.open}
              </a>
              <a href={t.pdf.url} download={t.pdf.fileName} className="btn btn-ghost h-10 min-h-0 flex-1 px-4 text-sm">
                {t.pdf.download}
              </a>
            </div>
          </div>
        </div>
      </Reveal>

    </section>
  );
}

export function StepTaskSubmission({ items, setItems, limits, submitting, error, review, onReviewChange, reviewError, onBack, onSubmit }: Props) {
  const t = content.task;
  return (
    <section aria-labelledby="task-submission-title">

      {/* 3. Screenshots */}
      <Reveal className="glass mt-6 rounded-(--radius-tile) p-5 sm:p-8">
        <h2 id="task-submission-title" className="mb-5 text-lg font-bold">{t.upload.title}</h2>
        <Uploader items={items} setItems={setItems} limits={limits} disabled={submitting} />
      </Reveal>

      {/* 4. Review */}
      <Reveal className="glass mt-6 rounded-(--radius-tile) p-5 sm:p-8">
        <h2 className="text-lg font-bold">
          <label htmlFor="review">{t.review.title}</label>
        </h2>
        <p id="review-hint" className="mt-1 text-sm text-ink-soft">
          {t.review.hint}
        </p>
        <textarea
          id="review"
          className="field mt-4 min-h-36 resize-y"
          placeholder={t.review.placeholder}
          value={review}
          maxLength={reviewConfig.maxLength}
          onChange={(e) => onReviewChange(e.target.value)}
          disabled={submitting}
          aria-invalid={reviewError ? true : undefined}
          aria-describedby={reviewError ? "review-hint review-error" : "review-hint"}
        />
        <div className="mt-2 flex items-start gap-3 text-xs">
          <p id="review-error" className="text-danger" role={reviewError ? "alert" : undefined}>
            {reviewError}
          </p>
          <span className="ml-auto text-slate tabular-nums">{t.review.counter(review.length, reviewConfig.maxLength)}</span>
        </div>
      </Reveal>

      {/* Actions: pinned to the bottom of the screen on phones, inline on larger screens. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-8 border-t border-line bg-paper/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="flex items-center gap-3">
          <button type="button" className="btn btn-ghost px-4 sm:px-6" onClick={onBack} disabled={submitting}>
            <span aria-hidden>←</span> <span className="sr-only sm:not-sr-only">{t.back}</span>
          </button>
          <button type="button" className="btn btn-primary flex-1 sm:ml-auto sm:min-w-60 sm:flex-none" onClick={onSubmit} disabled={submitting} aria-busy={submitting}>
            {submitting ? t.submitting : t.submit} {!submitting && <span aria-hidden className="arrow">→</span>}
          </button>
        </div>
        <p className="mt-2 text-sm text-danger empty:hidden sm:mt-3 sm:min-h-5 sm:text-right sm:empty:block" role="alert">
          {error}
        </p>
      </div>
    </section>
  );
}
