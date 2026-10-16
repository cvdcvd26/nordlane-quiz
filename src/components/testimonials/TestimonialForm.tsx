"use client";
import { useState } from "react";
import { content } from "@/config/content";
import { testimonialConfig } from "@/config/settings";
import { api } from "@/lib/api";
import { Stars } from "./TestimonialCard";

export type VisitorTestimonial = {
  requested: boolean;
  submitted: { name: string; rating: number; body: string; status: "pending" | "published" | "rejected" } | null;
};

const f = content.testimonials.form;

/**
 * Review form on the final screen. Locked until the manager asks for a review in the chat;
 * after sending it shows what was sent and its moderation state.
 */
export function TestimonialForm({ state, defaultName, onSent }: { state: VisitorTestimonial | null; defaultName: string; onSent: (s: VisitorTestimonial) => void }) {
  const [name, setName] = useState(defaultName);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = !state?.requested;
  const sent = state?.submitted;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(content.errors.nameRequired);
    if (rating < 1) return setError(content.errors.ratingRequired);
    if (body.trim().length < testimonialConfig.minLength) return setError(content.errors.testimonialTooShort);
    setBusy(true);
    try {
      const { testimonial } = await api<{ testimonial: NonNullable<VisitorTestimonial["submitted"]> }>("/api/testimonial", {
        method: "POST",
        json: { name: name.trim(), rating, body: body.trim() },
      });
      onSent({ requested: true, submitted: testimonial });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="testimonial-title" className="glass rounded-(--radius-tile) p-5 sm:p-7">
      <div className="flex items-center gap-3">
        <h2 id="testimonial-title" className="text-lg font-bold">
          {f.title}
        </h2>
        {locked && (
          <svg aria-hidden viewBox="0 0 24 24" className="size-4 text-slate" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </div>

      {sent ? (
        <div className="mt-4 rounded-(--radius-field) border border-paint/30 bg-paint-soft px-4 py-3.5" role="status">
          <Stars value={sent.rating} />
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{sent.body}</p>
          <p className="mt-3 text-sm font-semibold text-paint">{sent.status === "published" ? f.published : sent.status === "rejected" ? f.rejected : f.sent}</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-1">
          <p className="text-sm text-ink-soft">{locked ? f.locked : f.intro}</p>
          <fieldset disabled={locked || busy} className={`mt-5 grid gap-4 transition-opacity ${locked ? "opacity-45" : ""}`}>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block text-sm font-medium">
                {f.name}
                <input className="field mt-1.5" value={name} maxLength={testimonialConfig.maxNameLength} onChange={(e) => setName(e.target.value)} />
              </label>
              <div>
                <span id="rating-label" className="block text-sm font-medium">
                  {f.rating}
                </span>
                <div role="radiogroup" aria-labelledby="rating-label" className="mt-1.5 flex h-[3.1rem] items-center gap-1" onMouseLeave={() => setHover(0)}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={f.star(n)}
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHover(n)}
                      className="grid size-9 place-items-center rounded-md transition-transform hover:scale-110 disabled:hover:scale-100"
                    >
                      <svg viewBox="0 0 20 20" aria-hidden className={`size-6 ${n <= (hover || rating) ? "text-paint" : "text-line-strong"}`} fill="currentColor">
                        <path d="M10 1.8l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.43 5.06 17.01 6 11.51l-4-3.9 5.53-.8z" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <label htmlFor="testimonial-body" className="block text-sm font-medium">
                {f.body}
              </label>
              <textarea
                id="testimonial-body"
                className="field mt-1.5 min-h-28 resize-y"
                placeholder={f.placeholder}
                value={body}
                maxLength={testimonialConfig.maxLength}
                onChange={(e) => setBody(e.target.value)}
              />
              <span className="mt-1 block text-right text-xs text-slate tabular-nums">{f.counter(body.length, testimonialConfig.maxLength)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" className="btn btn-primary">
                {busy ? f.submitting : f.submit}
              </button>
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
