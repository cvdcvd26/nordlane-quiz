"use client";
import { content } from "@/config/content";
import { Uploader, type UploadItem } from "./Uploader";

type Props = {
  items: UploadItem[];
  setItems: (fn: (prev: UploadItem[]) => UploadItem[]) => void;
  limits: { maxFiles: number; maxFileSizeBytes: number; types: string[] };
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSubmit: () => void;
};

export function StepTask({ items, setItems, limits, submitting, error, onBack, onSubmit }: Props) {
  const t = content.task;
  return (
    <section aria-labelledby="task-title" className="step-enter">
      <p className="text-sm font-medium text-slate">{t.eyebrow}</p>
      <h1 id="task-title" className="display mt-3 text-[clamp(1.9rem,4.6vw,3.25rem)] font-semibold">
        {t.assignment.title}
      </h1>
      <p className="measure mt-4 text-lg leading-relaxed text-ink-soft">{t.assignment.body}</p>

      {/* About: a quiet block, not a card */}
      <div className="mt-12 grid gap-6 border-t-2 border-line pt-8 md:grid-cols-[1fr_auto] md:gap-10">
        <div>
          <h2 className="text-lg font-semibold">{t.about.title}</h2>
          <p className="measure mt-2 leading-relaxed text-ink-soft">{t.about.body}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 md:w-80 md:grid-cols-1 md:gap-3">
          {t.about.facts.map((f) => (
            <div key={f.label} className="md:flex md:items-baseline md:gap-3">
              <dt className="sr-only">{f.label}</dt>
              <dd className="display text-xl font-semibold md:w-24">{f.value}</dd>
              <dd className="text-sm text-slate">{f.label}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Instructions are a sequence, hence numbering */}
      <div className="mt-10 grid gap-8 md:grid-cols-[1fr_minmax(0,17rem)]">
        <div>
          <h2 className="text-lg font-semibold">{t.instructions.title}</h2>
          <ol className="mt-4 space-y-4">
            {t.instructions.steps.map((s, i) => (
              <li key={s} className="flex gap-4">
                <span className="display grid size-8 shrink-0 place-items-center rounded-full bg-paint text-sm font-bold">
                  {i + 1}
                </span>
                <span className="measure pt-1 leading-relaxed text-ink-soft">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* PDF as a "ticket" */}
        <div className="self-start rounded-(--radius-tile) bg-ink p-5 text-surface">
          <div className="flex items-start gap-3">
            <span aria-hidden className="grid h-12 w-10 shrink-0 place-items-center rounded-md bg-paint text-[0.65rem] font-bold text-ink">
              PDF
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{t.pdf.title}</p>
              <p className="truncate text-sm text-line">{t.pdf.fileName}</p>
            </div>
          </div>
          <div className="mt-5 flex gap-2">
            <a href={t.pdf.url} target="_blank" rel="noopener" className="btn h-10 min-h-0 flex-1 bg-surface px-4 text-sm text-ink hover:bg-paint">
              {t.pdf.open}
            </a>
            <a href={t.pdf.url} download className="btn h-10 min-h-0 flex-1 border-[1.5px] border-line/40 px-4 text-sm hover:border-paint">
              {t.pdf.download}
            </a>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <h2 className="mb-4 text-lg font-semibold">{t.upload.title}</h2>
        <Uploader items={items} setItems={setItems} limits={limits} disabled={submitting} />
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 border-t-2 border-line pt-6 sm:flex-row sm:items-center">
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={submitting}>
          {t.back}
        </button>
        <button type="button" className="btn btn-primary sm:ml-auto sm:min-w-56" onClick={onSubmit} disabled={submitting} aria-busy={submitting}>
          {submitting ? t.submitting : t.submit}
        </button>
      </div>
      <p className="mt-3 min-h-5 text-sm text-danger sm:text-right" role="alert">
        {error}
      </p>
    </section>
  );
}
