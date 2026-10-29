import type { TaskRevision } from "@/config/task-revisions";

/** A slow poll must not reopen a request after its response was accepted. */
export function canReplaceRevision(current: TaskRevision | null, next: TaskRevision | null): boolean {
  if (!current || !next) return true;
  if (Date.parse(next.createdAt) < Date.parse(current.createdAt)) return false;
  if (current.id !== next.id) return true;
  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) return false;
  return !(current.status !== "pending" && next.status === "pending");
}

/** Initial/history loads stay silent; each new pending request can notify once per page. */
export function createRevisionNotificationTracker() {
  let initialized = false;
  const seen = new Set<string>();
  return {
    observe(revision: Pick<TaskRevision, "id" | "status"> | null): boolean {
      const notify = initialized && revision?.status === "pending" && !seen.has(revision.id);
      initialized = true;
      if (revision) {
        seen.add(revision.id);
        if (seen.size > 256) seen.delete(seen.values().next().value!);
      }
      return Boolean(notify);
    },
  };
}
