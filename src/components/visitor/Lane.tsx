"use client";
import { content } from "@/config/content";
import { X } from "lucide-react";

export type Step = 0 | 1 | 2 | 3;

/**
 * Progress as a lit lane: a mint beam fills up to the current stop.
 * Vertical on desktop, horizontal on mobile.
 */
export function Lane({ step, rejected = false }: { step: Step; rejected?: boolean }) {
  const labels = content.progress.steps;
  const fraction = step / (labels.length - 1);

  return (
    <nav aria-label={content.progress.label} className="relative">
      <p className="sr-only" aria-live="polite">
        {rejected ? content.progress.rejected : content.progress.stepOf(step + 1, labels.length, labels[step])}
      </p>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={labels.length}
        aria-valuenow={step + 1}
        aria-valuetext={rejected ? content.progress.rejected : labels[step]}
        className="relative flex justify-between md:h-[min(52vh,420px)] md:flex-col"
      >
        {/* Track */}
        <span
          aria-hidden
          className={`absolute top-[13px] right-[14px] left-[14px] h-px ${rejected ? "bg-[#3b3d41]" : "bg-line-strong"} md:top-[14px] md:right-auto md:bottom-[14px] md:left-[14px] md:h-auto md:w-px`}
        />
        {/* Beam (horizontal / vertical) */}
        <span
          aria-hidden
          className={`absolute top-[12px] left-[14px] h-[3px] rounded-full ${rejected ? "bg-[#606367]" : "bg-paint"} transition-[width] duration-1000 ease-(--ease-lane) md:hidden`}
          style={{ width: `calc((100% - 28px) * ${fraction})` }}
        />
        <span
          aria-hidden
          className={`absolute top-[14px] left-[13px] hidden w-[3px] rounded-full ${rejected ? "bg-[#606367]" : "bg-paint"} transition-[height] duration-1000 ease-(--ease-lane) md:block`}
          style={{ height: `calc((100% - 28px) * ${fraction})` }}
        />

        {labels.map((label, i) => {
          // Reaching the receipt screen means the task was saved successfully.
          const state = rejected && i === labels.length - 1 ? "rejected" : i < step || step === labels.length - 1 ? "done" : i === step ? "current" : "next";
          return (
            <div key={label} className="relative z-10 flex flex-col items-center gap-2 md:flex-row md:gap-4">
              <span
                aria-hidden
                className={[
                  "grid size-[28px] place-items-center rounded-full text-xs font-bold transition-all duration-500",
                  state === "done" && (rejected ? "bg-[#3b3d41] text-[#d9dcdf]" : "bg-paint text-on-paint"),
                  state === "rejected" && "border border-[#925564] bg-[#3b2028] text-[#e5a1b3]",
                  state === "current" && "border border-paint bg-paper text-cyan",
                  state === "next" && "border border-line-strong bg-paper text-slate",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {state === "rejected" ? <X size={16} strokeWidth={2.5} /> : state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-xs font-semibold transition-colors duration-500 md:text-sm ${
                  rejected ? state === "rejected" ? "text-[#d7a1ad]" : "text-[#a5a7ac]" : state === "next" ? "text-slate" : i === step ? "text-ink" : "text-ink-soft"
                }`}
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
