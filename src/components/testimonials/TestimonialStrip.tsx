"use client";
import { useEffect, useState } from "react";
import { content } from "@/config/content";
import { testimonialConfig } from "@/config/settings";
import { api } from "@/lib/api";
import { TestimonialCard, type TestimonialView } from "./TestimonialCard";

const demo: TestimonialView[] = content.testimonials.demo.map((d, i) => ({ ...d, id: `demo-${i}`, demo: true }));

/**
 * Endless strip of published reviews under the first heading.
 * Marked placeholders fill it until enough real reviews are published.
 * Pauses on hover/focus; with reduced motion it becomes a plain horizontal scroller.
 */
export function TestimonialStrip({ className = "" }: { className?: string }) {
  const [items, setItems] = useState<TestimonialView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ items: TestimonialView[] }>("/api/testimonials")
      .then((r) => !cancelled && setItems(r.items))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items) return <div className={`h-[8.5rem] ${className}`} aria-hidden />;
  const list = items.length >= testimonialConfig.demoUntil ? items : [...items, ...demo];
  if (!list.length) return null;
  // Enough copies that one copy is wider than the screen; the track then moves by exactly one copy.
  const copy = list.length < 6 ? [...list, ...list] : list;
  const duration = `${copy.length * 7}s`;

  return (
    <section aria-label={content.testimonials.stripLabel} className={`marquee group relative -mx-4 sm:mx-0 ${className}`}>
      <div className="marquee-track flex w-max gap-3 py-1" style={{ "--marquee-duration": duration } as React.CSSProperties}>
        {copy.map((t, i) => (
          <TestimonialCard key={`a-${t.id}-${i}`} t={t} />
        ))}
        <div aria-hidden className="marquee-dup flex gap-3">
          {copy.map((t, i) => (
            <TestimonialCard key={`b-${t.id}-${i}`} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
