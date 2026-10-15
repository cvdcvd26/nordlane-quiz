import { useAdminI18n } from "@/components/admin/i18n";

const steps = ["contact", "questions", "submitted"];

/** Funnel stage: three dots, filled up to where the visitor got. */
export function StageBadge({ stage }: { stage: string }) {
  const { t } = useAdminI18n();
  const reached = steps.indexOf(stage);
  return (
    <span className="inline-flex items-center gap-2 text-xs whitespace-nowrap text-ink-soft">
      <span className="flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <span key={s} className={`size-1.5 rounded-full ${i <= reached ? "bg-cyan shadow-[0_0_6px_#00d9ff]" : "bg-line-strong"}`} />
        ))}
      </span>
      {t.ui.stages[stage] ?? stage}
    </span>
  );
}
