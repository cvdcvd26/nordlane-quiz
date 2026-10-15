"use client";
import { content } from "@/config/content";
import { reviewConfig } from "@/config/settings";
import { Uploader, type UploadItem } from "./Uploader";
import { Reveal } from "../visual/Reveal";
import { NetworkOrbit } from "../visual/NetworkOrbit";

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

export function StepTask({ items, setItems, limits, submitting, error, review, onReviewChange, reviewError, onBack, onSubmit }: Props) {
  const t = content.task;
  return (
    <section aria-labelledby="about-title">
      {/* 1. About the company — the first thing after the questions */}
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_16rem]">
        <div>
          <p className="chip reveal" style={delay(0)}>
            <span className="chip-dot" aria-hidden />
            {t.about.eyebrow}
          </p>
          <h1 id="about-title" className="display reveal mt-6 text-[clamp(2.5rem,6vw,4.6rem)] font-bold" style={delay(1)}>
            {t.about.title} <span className="accent-text">{t.about.titleAccent}</span>
          </h1>
          <p className="measure reveal mt-5 text-lg leading-relaxed text-ink-soft" style={delay(2)}>
            {t.about.body}
          </p>
        </div>
        <div className="reveal mx-auto hidden w-full lg:block" style={delay(3)}>
          <NetworkOrbit />
        </div>
      </div>

      {/* Key numbers */}
      <dl className="mt-10 grid grid-cols-3 gap-3 sm:gap-4">
        {t.about.facts.map((f, i) => (
          <Reveal key={f.label} index={i} className="glass card-hover rounded-(--radius-tile) p-4 sm:p-6">
            <dt className="sr-only">{f.label}</dt>
            <dd className="display accent-text text-[clamp(1.6rem,4.5vw,2.75rem)] font-bold">{f.value}</dd>
            <dd className="mt-1 text-xs text-ink-soft sm:text-sm">{f.label}</dd>
          </Reveal>
        ))}
      </dl>

      {/* Values */}
      <ul className="mt-4 grid gap-3 sm:grid-cols-3 sm:gap-4">
        {t.about.values.map((v, i) => (
          <Reveal as="li" key={v.title} index={i} className="glass card-hover group rounded-(--radius-tile) p-5">
            <span aria-hidden className="mb-4 grid size-9 place-items-center rounded-xl bg-paint/15 text-cyan ring-1 ring-paint/35 transition-transform duration-300 group-hover:translate-x-1">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                {i === 0 && <path d="M4 12l5 5L20 6" />}
                {i === 1 && <path d="M12 3v18M3 12h18" />}
                {i === 2 && <path d="M5 19L19 5M9 5h10v10" />}
              </svg>
            </span>
            <p className="font-bold">{v.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{v.body}</p>
          </Reveal>
        ))}
      </ul>

      {/* 2. The task */}
      <Reveal className="glass mt-14 rounded-(--radius-tile) p-5 sm:p-8">
        <div className="grid gap-8 md:grid-cols-[1fr_minmax(0,17rem)]">
          <div>
            <h2 className="display text-2xl font-bold sm:text-3xl">{t.assignment.title}</h2>
            <p className="measure mt-3 leading-relaxed text-ink-soft">{t.assignment.body}</p>

            <h3 className="mt-8 text-sm font-bold text-slate">{t.instructions.title}</h3>
            {/* A real sequence, so numbered, joined by a lit line */}
            <ol className="relative mt-4 space-y-5 before:absolute before:top-4 before:bottom-4 before:left-4 before:w-px before:bg-gradient-to-b before:from-cyan/60 before:to-transparent">
              {t.instructions.steps.map((s, i) => (
                <li key={s} className="relative flex gap-4">
                  <span className="display z-10 grid size-8 shrink-0 place-items-center rounded-full border border-cyan/50 bg-paper text-sm font-bold text-cyan">
                    {i + 1}
                  </span>
                  <span className="measure pt-1 leading-relaxed text-ink-soft">{s}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* PDF */}
          <div className="card-hover self-start rounded-(--radius-tile) border border-line-strong bg-gradient-to-b from-paint/15 to-surface-2 p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid h-12 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan to-paint text-[0.65rem] font-extrabold text-white shadow-[0_0_18px_#0099ff66]">
                PDF
              </span>
              <div className="min-w-0">
                <p className="font-bold">{t.pdf.title}</p>
                <p className="truncate text-sm text-slate">{t.pdf.fileName}</p>
              </div>
            </div>
            <div className="mt-5 flex gap-2">
              <a href={t.pdf.url} target="_blank" rel="noopener" className="btn btn-primary h-10 min-h-0 flex-1 px-4 text-sm">
                {t.pdf.open}
              </a>
              <a href={t.pdf.url} download className="btn btn-ghost h-10 min-h-0 flex-1 px-4 text-sm">
                {t.pdf.download}
              </a>
            </div>
          </div>
        </div>
      </Reveal>

      {/* 3. Screenshots */}
      <Reveal className="glass mt-6 rounded-(--radius-tile) p-5 sm:p-8">
        <h2 className="mb-5 text-lg font-bold">{t.upload.title}</h2>
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

      <Reveal className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={submitting}>
          <span aria-hidden>←</span> {t.back}
        </button>
        <button type="button" className="btn btn-primary sm:ml-auto sm:min-w-60" onClick={onSubmit} disabled={submitting} aria-busy={submitting}>
          {submitting ? t.submitting : t.submit} {!submitting && <span aria-hidden className="arrow">→</span>}
        </button>
      </Reveal>
      <p className="mt-3 min-h-5 text-sm text-danger sm:text-right" role="alert">
        {error}
      </p>
    </section>
  );
}
