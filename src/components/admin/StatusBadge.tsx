import { content, type LeadStatus } from "@/config/content";

const tone: Record<LeadStatus, string> = {
  new: "bg-paint text-on-paint",
  in_progress: "bg-sky/15 text-sky ring-1 ring-sky/30",
  awaiting_reply: "bg-cyan/10 text-cyan ring-1 ring-cyan/35",
  completed: "bg-white/5 text-ink-soft ring-1 ring-line-strong",
  rejected: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone[status]}`}>{content.admin.statuses[status]}</span>;
}
