import { content, type LeadStatus } from "@/config/content";

const tone: Record<LeadStatus, string> = {
  new: "bg-paint text-on-paint",
  in_progress: "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30",
  awaiting_reply: "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30",
  completed: "bg-ok/15 text-ok",
  rejected: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tone[status]}`}>{content.admin.statuses[status]}</span>;
}
