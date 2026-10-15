"use client";
import { Check, Inbox, CircleAlert } from "lucide-react";
import { LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { useAdminI18n } from "./i18n";

/* ---------- Status ---------- */

export const STATUS_TONE: Record<LeadStatus, { text: string; bg: string; dot: string }> = {
  new: { text: "text-adm-blue", bg: "bg-adm-blue-bg", dot: "bg-adm-blue" },
  in_progress: { text: "text-adm-amber", bg: "bg-adm-amber-bg", dot: "bg-[#c77d0a]" },
  awaiting_reply: { text: "text-adm-violet", bg: "bg-adm-violet-bg", dot: "bg-adm-violet" },
  completed: { text: "text-adm-green", bg: "bg-adm-green-bg", dot: "bg-adm-green" },
  rejected: { text: "text-adm-red", bg: "bg-adm-red-bg", dot: "bg-adm-red" },
};

/** Next step of the usual handling flow; completed/rejected have none. */
export const NEXT_STATUS: Partial<Record<LeadStatus, LeadStatus>> = {
  new: "in_progress",
  in_progress: "awaiting_reply",
  awaiting_reply: "completed",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useAdminI18n();
  const tone = STATUS_TONE[status];
  return (
    <span className={`adm-badge ${tone.bg} ${tone.text}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {t.ui.statuses[status]}
    </span>
  );
}

/** Compact select for changing a status in place (table rows). */
export function StatusSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: LeadStatus;
  onChange: (s: LeadStatus) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useAdminI18n();
  const tone = STATUS_TONE[value];
  return (
    <span className="relative inline-flex">
      <span aria-hidden className={`pointer-events-none absolute top-1/2 left-2.5 size-1.5 -translate-y-1/2 rounded-full ${tone.dot}`} />
      <select
        aria-label={label}
        className={`adm-input h-7 w-auto cursor-pointer border-transparent py-0 pl-6 text-[12.5px] font-semibold ${tone.bg} ${tone.text} hover:border-adm-line-strong`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as LeadStatus)}
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t.ui.statuses[s]}
          </option>
        ))}
      </select>
    </span>
  );
}

/* ---------- Stage: Kontakt → Pytania → Zadanie → Gotowe ---------- */

export type Stage = "questions" | "task" | "submitted";
const STAGE_INDEX: Record<Stage, number> = { questions: 1, task: 2, submitted: 3 };
export const stageIndex = (s: string) => STAGE_INDEX[s as Stage] ?? 1;

/** Four-segment indicator with the current screen's name (list rows). */
export function StageTrack({ stage, answered, total }: { stage: string; answered: number; total: number }) {
  const { t } = useAdminI18n();
  const current = stageIndex(stage);
  const done = stage === "submitted";
  const steps = t.ui.workflow.steps;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={steps.map((s, i) => `${i + 1}. ${s}`).join(" → ")}>
      <span aria-hidden className="flex gap-0.5">
        {steps.map((s, i) => (
          <span key={s} className={`h-1.5 w-3.5 rounded-sm ${i <= current ? (done ? "bg-adm-green" : "bg-adm-accent") : "bg-adm-line-strong"}`} />
        ))}
      </span>
      <span className={`text-[13px] ${done ? "font-semibold text-adm-green" : "text-adm-ink-2"}`}>
        {steps[current]}
        {current === 1 && <span className="ml-1 text-adm-ink-3 tabular-nums">{t.ui.workflow.answered(answered, total)}</span>}
      </span>
    </span>
  );
}

/** Full stepper for the lead page. */
export function StageStepper({ stage, answered, total }: { stage: string; answered: number; total: number }) {
  const { t } = useAdminI18n();
  const current = stageIndex(stage);
  const finished = stage === "submitted";
  const steps = t.ui.workflow.steps;
  return (
    <ol className="grid grid-cols-4 gap-2">
      {steps.map((label, i) => {
        const state = i < current || finished ? "done" : i === current ? "current" : "upcoming";
        const isCurrent = i === current;
        return (
          <li key={label} aria-current={isCurrent ? "step" : undefined} className="min-w-0">
            <div className={`h-1 rounded-full ${state === "upcoming" ? "bg-adm-line" : finished ? "bg-adm-green" : "bg-adm-accent"}`} />
            <div className="mt-2 flex items-center gap-1.5">
              <span
                aria-hidden
                className={`grid size-4.5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  state === "done"
                    ? finished
                      ? "bg-adm-green text-white"
                      : "bg-adm-accent text-white"
                    : state === "current"
                      ? "border-2 border-adm-accent text-adm-accent"
                      : "border border-adm-line-strong text-adm-ink-3"
                }`}
              >
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`truncate text-[13px] ${isCurrent ? "font-bold text-adm-ink" : state === "done" ? "text-adm-ink-2" : "text-adm-ink-3"}`}>{label}</span>
            </div>
            <p className="mt-0.5 pl-6 text-[12px] text-adm-ink-3">
              {isCurrent
                ? i === 1
                  ? `${t.ui.workflow.stepState.current} · ${t.ui.workflow.answered(answered, total)}`
                  : t.ui.workflow.stepState.current
                : t.ui.workflow.stepState[state]}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Page scaffolding and states ---------- */

export function PageHeader({ title, description, meta, actions }: { title: React.ReactNode; description?: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[20px] leading-tight font-bold tracking-[-0.01em]">{title}</h1>
          {meta && <span className="text-[13px] text-adm-ink-3">{meta}</span>}
        </div>
        {description && <p className="mt-1 text-[13px] text-adm-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Inbox aria-hidden className="size-6 text-adm-ink-3" strokeWidth={1.6} />
      <p className="max-w-sm text-[13.5px] text-adm-ink-2">{text}</p>
    </div>
  );
}

export function ErrorState({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { t } = useAdminI18n();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-[#efc2bd] bg-adm-red-bg px-4 py-3 text-[13.5px] text-adm-red">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">{text}</span>
      {onRetry && (
        <button type="button" className="adm-btn adm-btn-sm" onClick={onRetry}>
          {t.ui.common.retry}
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <div className="adm-skeleton h-3.5" style={{ width: `${c === 0 ? 40 : 50 + ((r * 7 + c * 13) % 40)}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
