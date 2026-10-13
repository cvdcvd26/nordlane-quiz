import { content, type LeadStatus } from "@/config/content";

const tone: Record<LeadStatus, string> = {
  new: "bg-paint text-ink",
  in_progress: "bg-ink text-surface",
  awaiting_reply: "bg-paint-soft text-ink border border-paint-deep/50",
  completed: "bg-ok/15 text-ok",
  rejected: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone[status]}`}>{content.admin.statuses[status]}</span>;
}
