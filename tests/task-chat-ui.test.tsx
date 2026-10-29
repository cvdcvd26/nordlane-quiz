// @vitest-environment happy-dom
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { content, QUESTION_KEYS } from "@/config/content";
import { chatConfig } from "@/config/settings";
import type { ChatMessage, PublicFile } from "@/lib/api";

const mocks = vi.hoisted(() => ({ api: vi.fn(), sound: vi.fn(), composerMount: vi.fn() }));
vi.mock("@/lib/api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/lib/sound", () => ({ playChime: mocks.sound }));
vi.mock("@/components/ui/SoundToggle", () => ({ SoundToggle: () => null }));
vi.mock("@/components/chat/ManagerAvatar", () => ({ ManagerAvatar: () => null }));
vi.mock("@/components/chat/Composer", () => ({
  Composer: function MockComposer({ onSend }: { onSend: (body: string, files: PublicFile[]) => void | Promise<void> }) {
    const [draft, setDraft] = useState("");
    useEffect(() => { mocks.composerMount(); }, []);
    return <div data-testid="mock-composer">
      <textarea aria-label="Draft" value={draft} readOnly />
      <button type="button" onClick={() => setDraft("Question draft remains here")}>Write draft</button>
      <button type="button" onClick={() => { void onSend("Question sent before the task", []); }}>Send question</button>
    </div>;
  },
}));

// Keep the actual QuizApp state/navigation and actual VisitorChat mounted together;
// expensive visual and upload children are unrelated to this lifecycle regression.
vi.mock("@/components/ui/LogoMark", () => ({ LogoMark: () => null }));
vi.mock("@/components/visitor/Lane", () => ({ Lane: () => null }));
vi.mock("@/components/visual/Backdrop", () => ({ Backdrop: () => null }));
vi.mock("@/components/visual/HalloweenSeason", () => ({ HalloweenSeason: () => null }));
vi.mock("@/components/visitor/VisitorTelemetry", () => ({ VisitorTelemetry: () => null }));
vi.mock("@/components/visitor/TaskRevisionPanel", () => ({ TaskRevisionPanel: () => null, TaskRevisionNotice: () => null }));
vi.mock("@/components/visitor/SubmissionConfirmation", () => ({
  SubmissionConfirmation: () => <h1 id="done-title">Task received</h1>, SubmissionFilesSummary: () => null,
}));
vi.mock("@/components/visitor/StepTask", () => ({
  StepTaskOverview: () => <h1>Task overview</h1>,
  StepTaskSubmission: ({ onSubmit, onBack }: { onSubmit: () => void; onBack: () => void }) => <div>
    <button type="button" onClick={onSubmit}>Submit task preview</button>
    <button type="button" onClick={onBack}>Back to questions preview</button>
  </div>,
}));
vi.mock("@/components/visitor/StepQuestions", () => ({
  StepQuestions: ({ onContinue }: { onContinue: () => void }) => <button type="button" onClick={onContinue}>Return to task preview</button>,
}));

import { VisitorChat } from "@/components/visitor/VisitorChat";
import { QuizApp } from "@/components/visitor/QuizApp";

let root: Root;
let host: HTMLDivElement;
let incoming: ChatMessage[];
let post: (body: { clientMessageId: string; body: string }) => unknown;
let chatCalls: number;
const manager = { id: "maja", name: "Maja (HR)", avatar: "/maja-hr.png" };
const message = (id: string, sequence: number, sender: ChatMessage["sender"], body: string): ChatMessage => ({
  id, sequence: String(sequence), sender, body, createdAt: "2026-10-29T10:00:00.000Z", clientMessageId: `client-${id}`, files: [],
});
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(chatConfig.pollIntervalMs); });
const launcher = () => host.querySelector<HTMLButtonElement>('button[aria-controls="visitor-chat-panel"]')!;
const panel = () => host.querySelector<HTMLDivElement>("#visitor-chat-panel")!;
const draft = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Draft"]')!;
const button = (label: string) => [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
const click = (node: HTMLElement) => act(async () => { node.click(); });
const renderChat = (props: { active?: boolean; collapsible?: boolean } = {}) => act(async () => root.render(<VisitorChat collapsible {...props} />));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  incoming = [message("history", 1, "admin", "Existing conversation history")];
  post = body => ({ message: { ...message("sent", 3, "visitor", body.body), clientMessageId: body.clientMessageId } });
  chatCalls = 0;
  mocks.api.mockReset(); mocks.sound.mockReset(); mocks.composerMount.mockReset();
  mocks.api.mockImplementation(async (url: string, init?: { method?: string; json?: { clientMessageId: string; body: string } }) => {
    if (url === "/api/chat" && init?.method === "POST") return post(init.json!);
    if (url.startsWith("/api/chat?")) {
      chatCalls++;
      const messages = incoming; incoming = [];
      return { messages, nextCursor: messages.at(-1)?.sequence ?? null, previousCursor: null, hasMore: false,
        changes: { updates: [], deletedIds: [], cursor: "0", hasMore: false }, manager, attachmentsEnabled: false, outcome: null };
    }
    if (url === "/api/session") return {
      answers: Object.fromEntries(QUESTION_KEYS.map(key => [key, "yes"])),
      contact: { name: "Test candidate", phone: "+48600123456", telegram: null }, submission: null, outcome: null,
      files: [{ id: "file-preview", name: "task.png", size: 123, mime: "image/png", url: "/test-file.png" }],
      limits: { maxFiles: 6, maxFileSizeBytes: 4000000, types: ["image/png"] },
    };
    if (url === "/api/submit") return { submissionId: "test-submission", submittedAt: "2026-10-29T10:30:00.000Z" };
    throw new Error(`Unexpected UI test request: ${url}`);
  });
  sessionStorage.clear();
  window.history.replaceState({}, "", "/step-3-task");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("task-stage help chat", () => {
  it("collapses without losing a composer draft, history, or a pending message", async () => {
    let resolvePost!: (value: unknown) => void;
    let sentId = "";
    post = body => { sentId = body.clientMessageId; return new Promise(resolve => { resolvePost = resolve; }); };
    await renderChat();
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    expect(mocks.sound).not.toHaveBeenCalled();
    await click(launcher());
    await click(button("Write draft"));
    const original = draft();
    expect(original.value).toBe("Question draft remains here");
    await click(button("Send question"));
    expect(panel().textContent).toContain("Question sent before the task");
    expect(panel().textContent).toContain(content.chat.sending);
    await click(launcher());
    expect(panel().hidden).toBe(true);
    await click(launcher());
    expect(draft()).toBe(original);
    expect(draft().value).toBe("Question draft remains here");
    expect(panel().textContent).toContain("Existing conversation history");
    expect(panel().textContent).toContain(content.chat.sending);
    await act(async () => resolvePost({ message: { ...message("confirmed", 2, "visitor", "Question sent before the task"), clientMessageId: sentId } }));
    expect(panel().textContent).not.toContain(content.chat.sending);
    expect(panel().textContent?.match(/Question sent before the task/g)).toHaveLength(1);
    expect(mocks.composerMount).toHaveBeenCalledOnce();
  });

  it("shows an unread badge for a new HR reply without expanding, and clears it when opened", async () => {
    await renderChat();
    expect(host.querySelector('[aria-label="Nowe wiadomości: 1"]')).toBeNull();
    incoming = [message("reply", 2, "admin", "Here is the answer from your HR")];
    await poll();
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(panel().hidden).toBe(true);
    expect(host.querySelector('[aria-label="Nowe wiadomości: 1"]')?.textContent).toBe("1");
    expect(mocks.sound).toHaveBeenCalledExactlyOnceWith("message");
    await click(launcher());
    expect(panel().hidden).toBe(false);
    expect(host.querySelector('[aria-label="Nowe wiadomości: 1"]')).toBeNull();
    expect(panel().textContent).toContain(manager.name);
    expect(panel().textContent).toContain("Here is the answer from your HR");
    await poll(); expect(mocks.sound).toHaveBeenCalledTimes(1);
  });

  it("pauses polling while another quiz step is active and resumes the same chat afterwards", async () => {
    await renderChat(); await click(launcher()); await click(button("Write draft"));
    const original = draft();
    await renderChat({ active: false });
    const calls = chatCalls;
    await poll(); await poll();
    expect(chatCalls).toBe(calls);
    await renderChat({ active: true });
    expect(chatCalls).toBe(calls + 1);
    expect(draft()).toBe(original);
    expect(draft().value).toBe("Question draft remains here");
    expect(mocks.composerMount).toHaveBeenCalledOnce();
  });

  it("keeps one chat and composer through actual task → questions → task → confirmation navigation", async () => {
    sessionStorage.setItem("nl_review_draft", "Opis wykonanego zadania na potrzeby testu.");
    await act(async () => root.render(createElement(QuizApp)));
    expect(host.textContent).toContain("Task overview");
    await click(launcher()); await click(button("Write draft"));
    const original = draft();
    await click(button("Back to questions preview"));
    expect(window.location.pathname).toBe("/step-2");
    const calls = chatCalls; await poll(); expect(chatCalls).toBe(calls);
    await click(button("Return to task preview"));
    expect(window.location.pathname).toBe("/step-3-task");
    expect(draft()).toBe(original);
    await click(button("Submit task preview"));
    expect(window.location.pathname).toBe("/step-4-confirmation");
    expect(host.textContent).toContain("Task received");
    expect(host.querySelector('button[aria-controls="visitor-chat-panel"]')).toBeNull();
    expect(panel().hidden).toBe(false);
    expect(draft()).toBe(original);
    expect(draft().value).toBe("Question draft remains here");
    expect(panel().textContent).toContain("Existing conversation history");
    expect(mocks.composerMount).toHaveBeenCalledOnce();
  });

  it("does not mount or poll the help chat before all three saved quiz answers", async () => {
    const handler = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (url: string, init?: unknown) => {
      const value = await handler(url, init);
      if (url === "/api/session") delete value.answers[QUESTION_KEYS.at(-1)!];
      return value;
    });
    await act(async () => root.render(createElement(QuizApp)));
    expect(window.location.pathname).toBe("/step-2");
    expect(host.querySelector('button[aria-controls="visitor-chat-panel"]')).toBeNull();
    expect(chatCalls).toBe(0);
    expect(mocks.composerMount).not.toHaveBeenCalled();
    await poll(); expect(chatCalls).toBe(0);
  });
});
