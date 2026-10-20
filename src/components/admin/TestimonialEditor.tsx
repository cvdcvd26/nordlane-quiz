"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Star, X } from "lucide-react";
import { testimonialConfig } from "@/config/settings";
import { api } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";
import type { TestimonialStatus } from "./ui";

export type EditableTestimonial = {
  id: string;
  name: string;
  city: string | null;
  age: number | null;
  rating: number;
  body: string;
  status: TestimonialStatus;
};

export function TestimonialEditor({
  review,
  onClose,
  onSaved,
}: {
  review: EditableTestimonial | null;
  onClose: () => void;
  onSaved: (status: TestimonialStatus) => void;
}) {
  const { t, err: tErr } = useAdminI18n();
  const M = t.ui.testimonials;
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [rating, setRating] = useState(review?.rating ?? 5);
  const [status, setStatus] = useState<TestimonialStatus>(review?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = previous;
    };
  }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!name) return setError(t.errors.nameRequired);
    if (body.length < testimonialConfig.minLength) return setError(t.errors.testimonialTooShort);
    const city = String(form.get("city") ?? "").trim() || null;
    const ageValue = String(form.get("age") ?? "").trim();
    const age = ageValue ? Number(ageValue) : null;
    setBusy(true);
    setError(null);
    try {
      await api(review ? `/api/admin/testimonials/${review.id}` : "/api/admin/testimonials", {
        method: review ? "PATCH" : "POST",
        json: { name, city, age, rating, body, status },
      });
      toast({ kind: "success", title: review ? M.saved : M.added });
      onSaved(status);
    } catch (e) {
      setError(tErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[92vw] max-w-xl overflow-auto rounded-xl border border-adm-line bg-adm-surface p-0 text-adm-ink shadow-2xl backdrop:bg-black/45"
    >
      <div className="flex items-center gap-3 border-b border-adm-line px-5 py-4">
        <h2 id={`${id}-title`} className="flex-1 text-lg font-bold">{review ? M.editTitle : M.createTitle}</h2>
        <button type="button" aria-label={M.close} className="adm-btn adm-btn-quiet size-8 p-0" disabled={busy} onClick={onClose}>
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <form onSubmit={(event) => void save(event)} aria-busy={busy} className="space-y-4 p-5">
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <label htmlFor={`${id}-name`} className="mb-1.5 block text-[13px] font-semibold">{M.name}</label>
            <input id={`${id}-name`} name="name" className="adm-input" defaultValue={review?.name ?? ""} maxLength={testimonialConfig.maxNameLength} required autoFocus autoComplete="off" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div>
              <label htmlFor={`${id}-city`} className="mb-1.5 block text-[13px] font-semibold">{M.city} <span className="font-normal text-adm-ink-3">({M.optional})</span></label>
              <input id={`${id}-city`} name="city" className="adm-input" defaultValue={review?.city ?? ""} maxLength={100} autoComplete="off" />
            </div>
            <div>
              <label htmlFor={`${id}-age`} className="mb-1.5 block text-[13px] font-semibold">{M.age}</label>
              <input id={`${id}-age`} name="age" type="number" inputMode="numeric" min={1} max={120} step={1} className="adm-input" defaultValue={review?.age ?? ""} aria-describedby={`${id}-optional-age`} />
              <span id={`${id}-optional-age`} className="mt-1 block text-[11px] text-adm-ink-3">{M.optional}</span>
            </div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-semibold">{M.ratingLabel}</legend>
            <div className="flex flex-wrap items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className="relative cursor-pointer rounded-md">
                  <input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} className="peer sr-only" aria-label={M.rating(value)} />
                  <span className="flex size-10 items-center justify-center rounded-md border border-adm-line bg-adm-bg transition-colors peer-checked:border-adm-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-adm-accent">
                    <Star aria-hidden className={`size-5 ${value <= rating ? "fill-amber-400 text-amber-500" : "text-adm-ink-3"}`} />
                  </span>
                </label>
              ))}
              <span aria-live="polite" className="ml-2 text-[12.5px] text-adm-ink-2">{M.rating(rating)}</span>
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-body`} className="mb-1.5 block text-[13px] font-semibold">{M.body}</label>
            <textarea id={`${id}-body`} name="body" rows={5} className="adm-input resize-y leading-relaxed" defaultValue={review?.body ?? ""} minLength={testimonialConfig.minLength} maxLength={testimonialConfig.maxLength} required aria-describedby={`${id}-body-hint`} />
            <p id={`${id}-body-hint`} className="mt-1 text-[12px] text-adm-ink-3">{M.bodyHint}</p>
          </div>
          <div>
            <label htmlFor={`${id}-status`} className="mb-1.5 block text-[13px] font-semibold">{M.statusLabel}</label>
            <select id={`${id}-status`} className="adm-input" value={status} onChange={(event) => setStatus(event.target.value as TestimonialStatus)} aria-describedby={`${id}-status-hint`}>
              {(["pending", "published", "rejected"] as const).map((value) => <option key={value} value={value}>{M.statuses[value]}</option>)}
            </select>
            <p id={`${id}-status-hint`} className="mt-1.5 text-[12px] leading-relaxed text-adm-ink-3">{M.statusHint}</p>
          </div>
        </fieldset>
        {error && <p role="alert" className="rounded-lg border border-adm-red/20 bg-adm-red-bg px-3 py-2 text-[13px] text-adm-red">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-adm-line pt-4">
          <button type="button" className="adm-btn" disabled={busy} onClick={onClose}>{M.cancel}</button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={busy}>{busy ? M.saving : status === "published" && !review ? M.publish : M.save}</button>
        </div>
      </form>
    </dialog>
  );
}
