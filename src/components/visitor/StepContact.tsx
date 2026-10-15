"use client";
import { content } from "@/config/content";
import { ContactFields, type ContactDraft, type ContactErrors } from "./ContactFields";
import { PixelHeading } from "../visual/PixelHeading";

type Props = {
  contact: ContactDraft;
  errors: ContactErrors;
  onChange: (next: ContactDraft, field: keyof ContactDraft) => void;
  saving: boolean;
  error: string | null;
  onContinue: () => void;
};

const delay = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** Step 1: hero + contact details. */
export function StepContact({ contact, errors, onChange, saving, error, onContinue }: Props) {
  const q = content.quiz;
  return (
    <section aria-labelledby="contact-title">
      <div>
        <div>
          <p className="chip reveal" style={delay(0)}>
            <span className="chip-dot" aria-hidden />
            {q.eyebrow}
          </p>
          <PixelHeading id="contact-title" wrapperClassName="reveal mt-6" style={delay(1)} className="display max-w-[15ch] text-[clamp(2.75rem,7vw,5.5rem)] font-bold">
            {q.title} <span className="accent-text">{q.titleAccent}</span>
          </PixelHeading>
          <p className="measure reveal mt-5 text-lg leading-relaxed text-ink-soft" style={delay(2)}>
            {q.description}
          </p>
        </div>
      </div>

      <form
        noValidate
        className="glass reveal mt-12 rounded-(--radius-tile) p-5 sm:p-7"
        style={delay(4)}
        onSubmit={(e) => {
          e.preventDefault();
          onContinue();
        }}
      >
        <ContactFields value={contact} errors={errors} onChange={onChange} />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="submit" className="btn btn-primary min-w-40" disabled={saving} aria-busy={saving}>
            {q.continue} <span aria-hidden className="arrow">→</span>
          </button>
          <span className="text-sm text-danger" role="alert">
            {error}
          </span>
        </div>
      </form>
    </section>
  );
}
