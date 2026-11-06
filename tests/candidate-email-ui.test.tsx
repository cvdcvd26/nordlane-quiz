// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/visual/PixelHeading", () => ({ PixelHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1> }));
vi.mock("@/components/testimonials/TestimonialStrip", () => ({ TestimonialStrip: () => null }));

import { CandidateEmailAccess, clearCandidateDrafts, type CandidateEmailState } from "@/components/visitor/CandidateEmailAccess";
import { StepContact } from "@/components/visitor/StepContact";

let host: HTMLDivElement;
let root: Root;
let changed: ReturnType<typeof vi.fn<() => void>>;
const guest: CandidateEmailState = { enabled: true, email: null, verified: false };
const account: CandidateEmailState = { enabled: true, email: "anna@example.com", verified: true };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const email = () => host.querySelector<HTMLInputElement>('input[type="email"]')!;
const code = () => host.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
const render = (state = guest) => act(async () => root.render(<CandidateEmailAccess state={state} onAccessChanged={changed} />));
const click = (element: HTMLElement) => act(async () => { element.click(); });
async function type(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  sessionStorage.clear();
  localStorage.clear();
  changed = vi.fn(); mocks.api.mockReset();
  mocks.api.mockImplementation(async (url: string) => url.endsWith("email-request") ? { challengeId: "challenge-1", expiresIn: 600, resendAfter: 60 } : { verified: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("candidate email access", () => {
  it("leaves the visitor flow untouched when email access is disabled", async () => {
    await render({ ...guest, enabled: false });
    expect(host.innerHTML).toBe(""); expect(mocks.api).not.toHaveBeenCalled();
  });

  it("verifies the browser's challenge and clears only candidate drafts before changing account", async () => {
    sessionStorage.setItem("nl_review_draft", "Private task draft");
    sessionStorage.setItem("nl_submit_key", "old-idempotency-key");
    sessionStorage.setItem("nl_revision_draft_7", "Private correction draft");
    sessionStorage.setItem("unrelated", "keep");
    changed.mockImplementation(() => {
      expect(sessionStorage.getItem("nl_review_draft")).toBeNull();
      expect(sessionStorage.getItem("nl_submit_key")).toBeNull();
      expect(sessionStorage.getItem("nl_revision_draft_7")).toBeNull();
    });
    await render(); await type(email(), "anna@example.com"); await click(button("Wyślij kod"));
    expect(mocks.api).toHaveBeenCalledWith("/api/candidate/email-request", { method: "POST", json: { email: "anna@example.com" } });
    expect(email().disabled).toBe(true); expect(host.textContent).toContain("anna@example.com");
    await type(code(), "123456"); await click(button("Potwierdź i przejdź dalej"));
    expect(mocks.api).toHaveBeenCalledWith("/api/candidate/email-verify", { method: "POST", json: { challengeId: "challenge-1", code: "123456" } });
    expect(changed).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("unrelated")).toBe("keep");
  });

  it("does not issue duplicate codes during an in-flight request or the resend cooldown", async () => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(); await type(email(), "anna@example.com");
    await act(async () => { button("Wyślij kod").click(); button("Wyślij kod").click(); });
    expect(mocks.api).toHaveBeenCalledOnce();
    await act(async () => finish({ challengeId: "challenge-1", expiresIn: 600, resendAfter: 60 }));
    expect(button("Wyślij ponownie za 60 s").disabled).toBe(true);
    await click(button("Wyślij ponownie za 60 s"));
    expect(mocks.api).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    await click(button("Wyślij kod ponownie"));
    expect(mocks.api).toHaveBeenCalledTimes(2);
  });

  it("keeps the entered code and existing drafts after verification fails", async () => {
    sessionStorage.setItem("nl_review_draft", "Keep this draft");
    await render(); await type(email(), "anna@example.com"); await click(button("Wyślij kod"));
    mocks.api.mockRejectedValueOnce(new Error("Kod jest nieprawidłowy lub wygasł."));
    await type(code(), "111111"); await click(button("Potwierdź i przejdź dalej"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Kod jest nieprawidłowy");
    expect(code().value).toBe("111111"); expect(changed).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("nl_review_draft")).toBe("Keep this draft");
  });

  it("explains transactional reminders without a preference switch and clears drafts on logout", async () => {
    await render(account);
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.textContent).toContain("30 minutach");
    expect(host.textContent).toContain("raz na 3 godziny");
    expect(mocks.api).not.toHaveBeenCalled();
    sessionStorage.setItem("nl_revision_draft_x", "Private draft");
    await click(button("Wyloguj się"));
    expect(mocks.api).toHaveBeenCalledWith("/api/candidate/logout", { method: "POST" });
    expect(sessionStorage.getItem("nl_revision_draft_x")).toBeNull(); expect(changed).toHaveBeenCalledOnce();
  });

  it("keeps the account and drafts intact after a failed logout", async () => {
    await render(account);
    sessionStorage.setItem("nl_review_draft", "Still mine");
    mocks.api.mockRejectedValueOnce(new Error("Spróbuj ponownie."));
    await click(button("Wyloguj się"));
    expect(changed).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("nl_review_draft")).toBe("Still mine");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Spróbuj ponownie.");
  });

  it("keeps logout available for an existing session while email sending is disabled", async () => {
    await render({ ...account, enabled: false });
    expect(host.textContent).toContain("anna@example.com");
    expect(host.querySelector('input[type="email"]')).toBeNull();
    await click(button("Wyloguj się"));
    expect(mocks.api).toHaveBeenCalledWith("/api/candidate/logout", { method: "POST" });
    expect(changed).toHaveBeenCalledOnce();
  });

  it("discloses codes, welcome and grouped HR emails before the send-code action", async () => {
    await render();
    const privacy = host.querySelector('[id$="-privacy"]')!;
    expect(privacy.textContent).toContain("wiadomości powitalnej");
    expect(privacy.textContent).toContain("nie marketing");
    expect(privacy.textContent).toContain("30 minutach");
    expect(privacy.compareDocumentPosition(button("Wyślij kod")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("blocks new contact collection until verification without nesting forms", async () => {
    const onContinue = vi.fn();
    await act(async () => root.render(<StepContact contact={{ name: "", phone: "", telegram: "" }} errors={{}} onChange={vi.fn()} saving={false} error={null} onContinue={onContinue}
      emailRequired emailAccess={<CandidateEmailAccess state={guest} onAccessChanged={changed} />} />));
    expect(host.querySelector("form form")).toBeNull();
    expect(button("Dalej →").disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>("#contact-name")?.closest("fieldset[disabled]")).not.toBeNull();
    await click(button("Dalej →")); expect(onContinue).not.toHaveBeenCalled();
    expect(email().disabled).toBe(false);
  });

  it("does not fail if browser storage is unavailable during account changes", () => {
    const get = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("disabled"); });
    expect(clearCandidateDrafts).not.toThrow(); get.mockRestore();
  });
});
