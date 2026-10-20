import { content } from "@/config/content";

export type TestimonialView = { id: string; name: string; city?: string | null; age?: number | null; rating: number; body: string; demo?: boolean };

const ageText = (age: number) => `${age} ${age === 1 ? "rok" : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14) ? "lata" : "lat"}`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function Stars({ value, className = "size-3.5" }: { value: number; className?: string }) {
  return (
    <span className="flex gap-0.5" role="img" aria-label={content.testimonials.stars(value)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" aria-hidden className={`${className} ${i <= value ? "text-paint" : "text-line-strong"}`} fill="currentColor">
          <path d="M10 1.8l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.43 5.06 17.01 6 11.51l-4-3.9 5.53-.8z" />
        </svg>
      ))}
    </span>
  );
}

/** Review in the style of a chat message: avatar with initials, name, stars, text. */
export function TestimonialCard({ t }: { t: TestimonialView }) {
  return (
    <figure className="flex w-[19rem] shrink-0 flex-col rounded-(--radius-field) border border-paint/30 bg-[#0d1a14] px-4 py-3.5 sm:w-[21rem]">
      <figcaption className="flex items-center gap-2.5">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-paint/15 text-[0.7rem] font-bold text-paint ring-1 ring-paint/30">
          {initials(t.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{t.name}</span>
            {t.demo && (
              <span className="shrink-0 rounded border border-line-strong px-1.5 text-[0.62rem] font-semibold tracking-wide text-slate uppercase">
                {content.testimonials.demoTag}
              </span>
            )}
          </span>
          {(t.age != null || t.city) && (
            <span className="mt-0.5 block truncate text-xs text-ink-soft">
              {[t.age != null ? ageText(t.age) : null, t.city].filter(Boolean).join(" · ")}
            </span>
          )}
          <Stars value={t.rating} className="mt-1 size-3" />
        </span>
      </figcaption>
      <blockquote className="mt-2.5 line-clamp-4 text-sm leading-relaxed text-ink">{t.body}</blockquote>
    </figure>
  );
}
