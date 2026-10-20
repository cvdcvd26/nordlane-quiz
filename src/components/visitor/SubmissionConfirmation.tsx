import { Check, CheckCheck, Files, MessageSquareText } from "lucide-react";
import { content } from "@/config/content";

export function SubmissionFilesSummary({ fileCount, muted = false }: { fileCount: number; muted?: boolean }) {
  const t = content.done;
  const iconColor = muted ? "text-ink-soft" : "text-paint/80";
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-ink-soft">
      <p className="flex items-center gap-1.5">
        <Files aria-hidden size={14} className={iconColor} />
        {t.filesSaved} <span className="font-semibold tabular-nums text-ink">{fileCount}</span>
      </p>
      <p className="flex items-center gap-1.5">
        <CheckCheck aria-hidden size={14} className={iconColor} />
        {t.noResend}
      </p>
    </div>
  );
}

export function SubmissionConfirmation({ fileCount }: { fileCount: number }) {
  const t = content.done;
  return (
    <div className="rounded-(--radius-tile) border border-paint/20 bg-surface/90 p-5 sm:p-7">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full border border-paint/25 bg-paint/10 text-paint">
          <Check size={23} strokeWidth={2} />
        </span>
        <p role="status" className="text-[11px] font-semibold tracking-[0.1em] text-paint uppercase">{t.status}</p>
      </div>

      <h1 id="done-title" className="display mt-5 text-[clamp(2.1rem,5vw,3.5rem)] font-bold">
        {t.title} <span className="accent-text">{t.titleAccent}</span>
      </h1>
      <p className="measure mt-4 text-[15px] leading-relaxed text-ink-soft sm:text-base">{t.body}</p>

      <SubmissionFilesSummary fileCount={fileCount} />

      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-paper/40 px-3.5 py-3">
        <MessageSquareText aria-hidden size={17} className="mt-0.5 shrink-0 text-paint/80" />
        <div>
          <h2 className="text-sm font-semibold">{t.nextTitle}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t.nextBody}</p>
        </div>
      </div>
    </div>
  );
}
