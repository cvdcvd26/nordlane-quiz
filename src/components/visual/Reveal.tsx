"use client";
import { useEffect, useRef } from "react";

/**
 * Fades and lifts its content in when it enters the viewport (once).
 * Uses IntersectionObserver; `index` staggers siblings by ~100 ms.
 */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className = "",
  children,
  style,
  ...rest
}: {
  as?: "div" | "li" | "section";
  index?: number;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={(el: HTMLElement | null) => {
        ref.current = el;
      }}
      {...rest}
      data-reveal=""
      className={className}
      style={{ ...style, "--i": index } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
