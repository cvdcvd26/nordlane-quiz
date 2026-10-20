"use client";
import { LockKeyhole } from "lucide-react";
import { content } from "@/config/content";
import { ContactFields, type ContactDraft, type ContactErrors } from "./ContactFields";
import { PixelHeading } from "../visual/PixelHeading";
import { TestimonialStrip } from "../testimonials/TestimonialStrip";

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
          <PixelHeading id="contact-title" wrapperClassName="reveal mt-6" style={delay(1)} className="display max-w-[19ch] text-[clamp(2.5rem,6.5vw,5rem)] font-bold">
            {q.title} <span className="accent-text">{q.titleAccent}</span>
          </PixelHeading>
          <div className="measure reveal mt-6 space-y-4 text-lg leading-relaxed text-ink-soft" style={delay(2)}>
            <p className="text-xl text-ink">{q.recruitment.lead} <strong className="text-cyan">{q.recruitment.highlight}</strong> {q.recruitment.ending}</p>
            <p>{q.description}</p>
            <p><span aria-hidden>✅ </span><strong className="text-ink">{q.invitation.title}</strong> {q.invitation.body}</p>
          </div>
        </div>
      </div>

      <TestimonialStrip className="reveal mt-10" />

      <form
        noValidate
        className="glass reveal mt-10 rounded-(--radius-tile) p-5 sm:p-7"
        style={delay(4)}
        onSubmit={(e) => {
          e.preventDefault();
          onContinue();
        }}
      >
        <ContactFields value={contact} errors={errors} onChange={onChange} />
        <p className="mt-5 flex max-w-[65ch] items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
          <span>{q.contact.privacy}</span>
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
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
