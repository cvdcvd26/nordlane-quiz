"use client";
import { content } from "@/config/content";

/**
 * Progress as road markings: the lane is painted yellow up to the current stop.
 * Vertical on desktop, horizontal on mobile.
 */
export function Lane({ step }: { step: 0 | 1 | 2 }) {
  const labels = content.progress.steps;
  const fraction = step / (labels.length - 1);

  return (
    <nav aria-label={content.progress.label} className="relative">
      <p className="sr-only" aria-live="polite">
        {content.progress.stepOf(step + 1, labels.length, labels[step])}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={labels.length}
        aria-valuenow={step + 1}
        aria-valuetext={labels[step]}
        className="relative flex justify-between md:h-[min(56vh,440px)] md:flex-col"
      >
        {/* Unpainted markings: dashed */}
        <span
          aria-hidden
          className="absolute top-[13px] right-[14px] left-[14px] h-0 border-t-[3px] border-dashed border-line-strong md:top-[14px] md:right-auto md:bottom-[14px] md:left-[13px] md:h-auto md:border-t-0 md:border-l-[3px]"
        />
        {/* Painted part */}
        <span
          aria-hidden
          className="absolute top-[12px] left-[14px] h-[5px] rounded-full bg-paint transition-[width] duration-700 ease-(--ease-lane) md:hidden"
          style={{ width: `calc((100% - 28px) * ${fraction})` }}
        />
        <span
          aria-hidden
          className="absolute top-[14px] left-[12px] hidden w-[5px] rounded-full bg-paint transition-[height] duration-700 ease-(--ease-lane) md:block"
          style={{ height: `calc((100% - 28px) * ${fraction})` }}
        />

        {labels.map((label, i) => {
          const state = i < step ? "done" : i === step ? "current" : "next";
          return (
            <div key={label} className="relative z-10 flex flex-col items-center gap-2 md:flex-row md:gap-4">
              <span
                aria-hidden
                className={[
                  "grid size-[29px] place-items-center rounded-full border-[3px] text-xs font-bold transition-colors duration-300",
                  state === "done" && "border-ink bg-ink text-paint",
                  state === "current" && "border-ink bg-paint text-ink",
                  state === "next" && "border-line-strong bg-paper text-slate",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-xs font-medium md:text-sm ${state === "next" ? "text-slate" : "text-ink"} ${state === "current" ? "md:font-semibold" : ""}`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
