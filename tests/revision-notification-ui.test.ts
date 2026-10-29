// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRevision } from "@/config/task-revisions";

const mocks = vi.hoisted(() => ({ api: vi.fn(), sound: vi.fn(), enabled: vi.fn(() => true) }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/lib/sound", () => ({
  bindAudioUnlock: vi.fn(), isSoundEnabled: mocks.enabled, playChime: mocks.sound,
  SOUND_PREFERENCE_EVENT: "alleybiz:sound-preference",
}));
vi.mock("@/components/visitor/RevisionUploader", () => ({ RevisionUploader: () => null }));
import { TaskRevisionPanel } from "@/components/visitor/TaskRevisionPanel";

let root: Root;
let host: HTMLDivElement;
let response: { revision: TaskRevision | null; files: [] };
const pending = (id: string, minute: string): TaskRevision => ({
  id, instructions: "Proszę dodać zrzut ekranu.", status: "pending",
  createdAt: `2026-10-29T10:${minute}:00.000Z`, updatedAt: `2026-10-29T10:${minute}:00.000Z`, submittedAt: null,
});
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(4000); });

beforeEach(() => {
  vi.useFakeTimers(); mocks.api.mockReset(); mocks.sound.mockReset(); mocks.enabled.mockReturnValue(true);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  response = { revision: null, files: [] };
  mocks.api.mockImplementation(async () => response);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers();
});

describe("candidate revision notifications", () => {
  it("sounds once for a new request, respects live mute and clears an old amber notice after submission", async () => {
    await act(async () => root.render(createElement(TaskRevisionPanel)));
    expect(mocks.sound).not.toHaveBeenCalled();
    response = { revision: pending("first", "01"), files: [] };
    await poll();
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith("revision");
    expect(host.textContent).toContain("Wymaga uzupełnienia");
    await poll(); expect(mocks.sound).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent("alleybiz:sound-preference", { detail: { scope: "visitor", on: false } }));
    response = { revision: pending("second", "02"), files: [] };
    await poll(); expect(mocks.sound).toHaveBeenCalledTimes(1);
    response = { revision: { ...response.revision!, status: "submitted", updatedAt: "2026-10-29T10:03:00.000Z" }, files: [] };
    await poll();
    expect(host.textContent).toContain("Poprawka otrzymana");
    expect(host.textContent).not.toContain("Wymaga uzupełnienia");
    window.dispatchEvent(new CustomEvent("alleybiz:sound-preference", { detail: { scope: "visitor", on: true } }));
    response = { revision: pending("third", "04"), files: [] };
    await poll(); expect(mocks.sound).toHaveBeenCalledTimes(2);
  });

  it("stays silent when reopening existing history, and stops polling when the candidate chat closes", async () => {
    response = { revision: pending("history", "01"), files: [] };
    const onRevisionChange = vi.fn();
    await act(async () => root.render(createElement(TaskRevisionPanel, { onRevisionChange })));
    await poll(); expect(mocks.sound).not.toHaveBeenCalled();
    expect(onRevisionChange).toHaveBeenLastCalledWith(response.revision);
    await act(async () => root.render(createElement(TaskRevisionPanel, { closed: true, onRevisionChange })));
    const calls = mocks.api.mock.calls.length;
    await poll(); expect(mocks.api).toHaveBeenCalledTimes(calls);
    expect(onRevisionChange).toHaveBeenLastCalledWith(null);
    expect(host.textContent).toBe("");
  });
});
