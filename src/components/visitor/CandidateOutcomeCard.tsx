import type { ReactNode } from "react";
import { Frown } from "lucide-react";

/** Shared by the visitor result and the admin's preview. */
export function CandidateOutcomeCard({
  title,
  body,
  as: Heading = "h2",
  id,
  live = true,
  children,
}: {
  title: string;
  body: string;
  as?: "h1" | "h2";
  id?: string;
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <div role={live ? "status" : undefined} aria-live={live ? "polite" : undefined} className="rounded-(--radius-tile) border border-[#69434d] border-t-2 bg-linear-to-br from-[#251419] via-[#120e10] to-[#0a0d0b] p-5 text-[#f0e8eb] sm:p-7">
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full border border-[#80535f]/60 bg-[#80535f]/15 text-[#c998a8]">
          <Frown size={25} strokeWidth={1.5} />
        </span>
        <p className="text-[10px] font-semibold tracking-[0.14em] text-[#c998a8] uppercase">Decyzja rekrutacyjna</p>
      </div>
      <Heading id={id} className="display mt-6 text-[clamp(1.65rem,4vw,2.5rem)] font-semibold leading-tight">{title}</Heading>
      <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-[#c4b6bc]">{body}</p>
      <p className="mt-6 border-t border-[#69434d]/50 pt-4 text-[13px] leading-relaxed text-[#b5a1a9]">
        Życzymy powodzenia w dalszych planach zawodowych.
      </p>
      {children}
    </div>
  );
}
