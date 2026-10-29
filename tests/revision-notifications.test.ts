import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRevisionNotificationTracker, canReplaceRevision } from "@/lib/revision-notifications";
import { TaskRevisionNotice } from "@/components/visitor/TaskRevisionPanel";
import type { TaskRevision } from "@/config/task-revisions";

const revision = (changes: Partial<TaskRevision> = {}): TaskRevision => ({
  id: "request-one", instructions: "Proszę uzupełnić zrzuty ekranu.", status: "pending",
  createdAt: "2026-10-29T10:00:00.000Z", updatedAt: "2026-10-29T10:00:00.000Z", submittedAt: null, ...changes,
});

describe("revision attention without repeated history chimes", () => {
  it("stays silent on initial/history loads, including a reload with a pending request", () => {
    expect(createRevisionNotificationTracker().observe(revision())).toBe(false);
    expect(createRevisionNotificationTracker().observe(revision())).toBe(false);
  });
  it("notifies once when a pending request arrives and never repeats on polling", () => {
    const tracker = createRevisionNotificationTracker();
    expect(tracker.observe(null)).toBe(false);
    expect(tracker.observe(revision())).toBe(true);
    expect(tracker.observe(revision())).toBe(false);
    expect(tracker.observe(revision({ status: "submitted" }))).toBe(false);
    expect(tracker.observe(revision({ id: "request-two" }))).toBe(true);
    expect(tracker.observe(revision({ id: "request-two" }))).toBe(false);
  });
  it("does not notify for submitted or cancelled requests", () => {
    const tracker = createRevisionNotificationTracker(); tracker.observe(null);
    expect(tracker.observe(revision({ status: "cancelled" }))).toBe(false);
    expect(tracker.observe(revision({ id: "two", status: "submitted" }))).toBe(false);
  });
  it("rejects an old poll after submitting, while allowing a newer request", () => {
    const submitted = revision({ status: "submitted", updatedAt: "2026-10-29T10:01:00.000Z" });
    expect(canReplaceRevision(submitted, revision())).toBe(false);
    expect(canReplaceRevision(submitted, revision({ updatedAt: submitted.updatedAt }))).toBe(false);
    expect(canReplaceRevision(submitted, revision({ id: "new", createdAt: "2026-10-29T10:02:00.000Z" }))).toBe(true);
    expect(canReplaceRevision(submitted, revision({ id: "old", createdAt: "2026-10-29T09:59:00.000Z" }))).toBe(false);
  });
  it("shows an actionable Polish notice only while a revision needs attention", () => {
    const render = (value: TaskRevision | null) => renderToStaticMarkup(createElement(TaskRevisionNotice, { revision: value }));
    expect(render(null)).toBe("");
    expect(render(revision({ status: "submitted" }))).toBe("");
    expect(render(revision({ status: "cancelled" }))).toBe("");
    const html = render(revision());
    expect(html).toContain("Wymaga uzupełnienia");
    expect(html).toContain("Przejdź do poprawy");
    expect(html).toContain('role="status"');
    expect(html).toContain("#f4c470");
  });
});
