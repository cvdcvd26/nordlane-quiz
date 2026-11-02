// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateOutcome } from "@/config/candidate-outcome";
import type { VisitorChat } from "@/components/visitor/VisitorChat";
import type { MetaQuizPixel } from "@/components/visitor/MetaQuizPixel";
import type { VisitorTelemetry } from "@/components/visitor/VisitorTelemetry";
import type { StepQuestions } from "@/components/visitor/StepQuestions";
import type { StepTaskSubmission } from "@/components/visitor/StepTask";

const mocks = vi.hoisted(() => ({ api: vi.fn(), chat: vi.fn(), pixel: vi.fn(), telemetry: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/lib/candidate-identity", () => ({ observeCandidateIdentity: () => ({ isCurrent: () => true, dispose: () => {} }) }));
vi.mock("@/components/ui/LogoMark", () => ({ LogoMark: () => null }));
vi.mock("@/components/visual/Backdrop", () => ({ Backdrop: () => null }));
vi.mock("@/components/visual/HalloweenSeason", () => ({ HalloweenSeason: () => null }));
vi.mock("@/components/visitor/StepContact", () => ({ StepContact: () => <div data-testid="contact" /> }));
vi.mock("@/components/visitor/StepQuestions", () => ({ StepQuestions: (props: ComponentProps<typeof StepQuestions>) => <div data-testid="questions">
  <span>{JSON.stringify(props.answers)}</span>
  <button onClick={() => props.onAnswer("q3", "yes")}>Last answer</button>
  <button onClick={props.onBack}>Back</button>
</div> }));
vi.mock("@/components/visitor/StepTask", () => ({
  StepTaskOverview: () => <div data-testid="task-overview" />,
  StepTaskSubmission: (props: ComponentProps<typeof StepTaskSubmission>) => <div data-testid="task-submission">{props.review}</div>,
}));
vi.mock("@/components/visitor/VisitorChat", () => ({ VisitorChat: (props: ComponentProps<typeof VisitorChat>) => {
  mocks.chat(props); return <div data-testid="chat" />;
} }));
vi.mock("@/components/visitor/MetaQuizPixel", () => ({ MetaQuizPixel: (props: ComponentProps<typeof MetaQuizPixel>) => { mocks.pixel(props); return null; } }));
vi.mock("@/components/visitor/VisitorTelemetry", () => ({ VisitorTelemetry: (props: ComponentProps<typeof VisitorTelemetry>) => { mocks.telemetry(props); return null; } }));
vi.mock("@/components/visitor/TaskRevisionPanel", () => ({ TaskRevisionNotice: () => null, TaskRevisionPanel: () => <div data-testid="revision" /> }));

import { QuizApp } from "@/components/visitor/QuizApp";
import { ApiError } from "@/lib/api";
import { chatConfig } from "@/config/settings";
import { content } from "@/config/content";

const rejected: CandidateOutcome = { status: "rejected", title: "Wynik zgłoszenia", body: "Nie będziemy kontynuować rekrutacji.", publishedAt: "2026-11-02T10:00:00.000Z" };
const makeSession = (outcome: CandidateOutcome | null = null, answers: Record<string, string> = { q1: "yes", q2: "yes", q3: "no" }) => ({
  marketingScope: "test-scope", contact: { name: "Test", phone: "+48555555555", telegram: null },
  answers, outcome, submission: null as { id: string; submittedAt: string } | null,
  files: [{ id: "file-1", name: "test.png", mime: "image/png", size: 10, url: "/api/files/test" }],
  limits: { maxFiles: 6, maxFileSizeBytes: 4194304, types: ["image/png"] },
});
let server: ReturnType<typeof makeSession>;
let host: HTMLDivElement;
let root: Root;
const render = () => act(async () => root.render(<QuizApp />));
const query = (id: string) => host.querySelector(`[data-testid="${id}"]`);
const chatProps = () => mocks.chat.mock.lastCall![0] as ComponentProps<typeof VisitorChat>;
const pixelProps = () => mocks.pixel.mock.lastCall![0] as ComponentProps<typeof MetaQuizPixel>;
const click = (label: string) => act(async () => { [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!.click(); });
const tick = (ms: number = chatConfig.pollIntervalMs) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  sessionStorage.clear(); localStorage.clear();
  window.history.replaceState(null, "", "/step-3-task");
  server = makeSession();
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.api.mockImplementation(async (url: string) => {
    if (url === "/api/session") return server;
    if (url === "/api/quiz/answer") return {};
    throw new Error(`Unexpected endpoint: ${url}`);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("published rejection before task submission", () => {
  it.each(["/", "/step-2", "/step-3-task"])("shows the outcome on initial load at %s without fabricating completion", async path => {
    window.history.replaceState(path === "/" ? { alleybizQuizStep: 0 } : null, "", path);
    server = makeSession(rejected);
    await render();
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    expect(host.textContent).toContain(rejected.body);
    expect(query("contact")).toBeNull(); expect(query("questions")).toBeNull();
    expect(query("task-overview")).toBeNull(); expect(query("task-submission")).toBeNull();
    expect(query("chat")?.closest("[hidden]")).not.toBeNull();
    expect(query("revision")).toBeNull();
    expect(host.textContent).not.toContain(content.done.filesSaved);
    expect(window.location.pathname).toBe(path);
    expect(pixelProps()).toMatchObject({ scope: null, submitted: false });
    expect(mocks.telemetry.mock.lastCall![0]).toMatchObject({ ready: false });
    const step = path === "/" ? 1 : path === "/step-2" ? 2 : 3;
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(String(step));
  });

  it("replaces the live task screen and hides chat, then restores the unsent task draft when retracted", async () => {
    sessionStorage.setItem("nl_review_draft", "Unsent task draft");
    await render();
    expect(query("task-submission")?.textContent).toBe("Unsent task draft");
    await act(async () => chatProps().onOutcome?.(rejected));
    expect(query("task-submission")).toBeNull();
    expect(query("chat")?.closest("[hidden]")).not.toBeNull();
    expect(chatProps()).toMatchObject({ closed: true, active: true });
    expect(window.location.pathname).toBe("/step-3-task");
    expect(pixelProps()).toMatchObject({ scope: null, step: 2, submitted: false });
    await act(async () => chatProps().onOutcome?.(null));
    expect(query("task-submission")?.textContent).toBe("Unsent task draft");
    expect(query("chat")?.closest("[hidden]")).toBeNull();
    expect(chatProps().closed).toBe(false);
  });

  it("polls before chat unlock and restores questions without overwriting local answers", async () => {
    window.history.replaceState(null, "", "/step-2");
    server = makeSession(null, { q1: "yes" });
    await render();
    await click("Last answer");
    expect(query("questions")?.textContent).toContain('"q3":"yes"');
    server = { ...server, outcome: rejected };
    await tick();
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    expect(query("questions")).toBeNull(); expect(query("chat")).toBeNull();
    expect(window.location.pathname).toBe("/step-2");
    server = { ...server, outcome: null };
    await tick();
    expect(query("questions")?.textContent).toContain('"q3":"yes"');
    expect(pixelProps().submitted).toBe(false);
  });

  it("cancels queued automatic navigation if rejection arrives after the last answer", async () => {
    window.history.replaceState(null, "", "/step-2");
    server = makeSession(null, { q1: "yes", q2: "yes" });
    await render(); await click("Last answer");
    server = { ...server, outcome: rejected };
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await tick(701);
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    expect(window.location.pathname).toBe("/step-2");
    expect(query("task-submission")).toBeNull();
    expect(pixelProps()).toMatchObject({ scope: null, step: 1, submitted: false });
  });

  it("refreshes the outcome immediately when a racing answer is rejected by the server", async () => {
    window.history.replaceState(null, "", "/step-2");
    server = makeSession(null, { q1: "yes", q2: "yes" });
    await render();
    server = { ...server, outcome: rejected };
    mocks.api.mockImplementationOnce(async () => { throw new ApiError("Zgłoszenie jest zamknięte.", 403, "candidate_application_closed"); });
    await click("Last answer");
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    expect(window.location.pathname).toBe("/step-2");
    expect(pixelProps()).toMatchObject({ scope: null, questionsComplete: false, submitted: false });
  });

  it("does not queue navigation when a pending final answer succeeds after rejection is displayed", async () => {
    window.history.replaceState(null, "", "/step-2");
    server = makeSession(null, { q1: "yes", q2: "yes" });
    await render();
    let finishAnswer!: () => void;
    mocks.api.mockImplementationOnce(() => new Promise<void>(resolve => { finishAnswer = resolve; }));
    await click("Last answer");
    server = { ...server, outcome: rejected };
    await tick();
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    await act(async () => finishAnswer());
    await tick(701);
    expect(window.location.pathname).toBe("/step-2");
    expect(query("task-submission")).toBeNull();
    expect(pixelProps()).toMatchObject({ scope: null, step: 1, submitted: false });
  });

  it("retains the saved-files receipt for an actually submitted rejected application", async () => {
    server = { ...makeSession(rejected), submission: { id: "submission-1", submittedAt: "2026-11-02T09:00:00Z" } };
    await render();
    expect(host.querySelector("h1")?.textContent).toBe(rejected.title);
    expect(host.textContent).toContain(content.done.filesSaved);
    expect(window.location.pathname).toBe("/step-4-confirmation");
    expect(pixelProps()).toMatchObject({ scope: null, step: 3, submitted: true });
  });
});
