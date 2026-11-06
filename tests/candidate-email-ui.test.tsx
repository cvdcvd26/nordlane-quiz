// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), api: mocks.api }));
vi.mock("@/components/visual/PixelHeading", () => ({ PixelHeading: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1> }));
vi.mock("@/components/testimonials/TestimonialStrip", () => ({ TestimonialStrip: () => null }));

import { CandidateEmailAccess, clearCandidateDrafts, type CandidateEmailState } from "@/components/visitor/CandidateEmailAccess";
import type { ContactDraft } from "@/components/visitor/ContactFields";
import { StepContact } from "@/components/visitor/StepContact";

let host: HTMLDivElement;
let root: Root;
let changed: ReturnType<typeof vi.fn<() => void>>;
const guest: CandidateEmailState = { enabled: true, email: null, verified: false };
const account: CandidateEmailState = { enabled: true, email: "anna@example.com", verified: true };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const email = () => host.querySelector<HTMLInputElement>('input[type="email"]')!;
const code = () => host.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
const contactField = (field: keyof ContactDraft) => host.querySelector<HTMLInputElement>(`#contact-${field}`)!;
const validContact: ContactDraft = { name: "Anna", phone: "+48 600 123 456", telegram: "@anna_test" };
const render = (state = guest) => act(async () => root.render(<CandidateEmailAccess state={state} onAccessChanged={changed} />));
function RegistrationFlow({ initialContact = validContact }: { initialContact?: ContactDraft }) {
  const [contact, setContact] = useState(initialContact);
  const [loginMode, setLoginMode] = useState(false);
  const [busy, setBusy] = useState(false);
  return <>
    <button type="button" disabled={busy} onClick={() => setLoginMode(true)}>Header login</button>
    <StepContact contact={contact} errors={{}} onChange={setContact} saving={false} error={null} onContinue={vi.fn()}
      showContactForm={false} emailAccess={<CandidateEmailAccess state={guest} onAccessChanged={changed}
        registration={{ contact, onChange: setContact }} loginMode={loginMode} onLoginModeChange={setLoginMode} onBusyChange={setBusy} />} />
  </>;
}
const renderRegistration = (initialContact?: ContactDraft) => act(async () => root.render(<RegistrationFlow initialContact={initialContact} />));
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
  mocks.api.mockImplementation(async (url: string) => url.endsWith("email-request") ? { challengeId: "challenge-1", expiresIn: 600, resendAfter: 60 } : { verified: true, contactCreated: false });
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
    expect(email()).toBeNull(); expect(host.textContent).toContain("anna@example.com");
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
    expect(host.textContent).toContain("nowych, nieprzeczytanych wiadomościach od HR");
    expect(host.textContent).toContain("Nie potrzebujesz hasła");
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

  it("discloses codes, welcome and private HR notifications before the send-code action", async () => {
    await render();
    const privacy = host.querySelector('[id$="-privacy"]')!;
    expect(privacy.textContent).toContain("wiadomości powitalnej");
    expect(privacy.textContent).toContain("nie marketing");
    expect(privacy.textContent).toContain("powiadomień o rozmowie z HR");
    expect(privacy.textContent).toContain("Nie wysyłamy treści rozmów ani dokumentów e-mailem");
    expect(privacy.compareDocumentPosition(button("Wyślij kod")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("validates all registration details locally before requesting a code", async () => {
    await renderRegistration({ name: "", phone: "", telegram: "!" });
    await type(email(), "invalid");
    await click(button("Dalej — potwierdź e-mail"));
    expect(mocks.api).not.toHaveBeenCalled();
    for (const field of ["name", "phone", "telegram"] as const) expect(contactField(field).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(contactField("name"));
    await type(contactField("name"), "Anna");
    await type(contactField("phone"), "600123456");
    await click(button("Dalej — potwierdź e-mail"));
    expect(document.activeElement).toBe(contactField("telegram"));
    expect(mocks.api).not.toHaveBeenCalled();
    await type(contactField("telegram"), "@anna_test");
    await click(button("Dalej — potwierdź e-mail"));
    expect(host.textContent).toContain("Wpisz poprawny adres e-mail.");
    expect(document.activeElement).toBe(email());
    expect(mocks.api).not.toHaveBeenCalled();
    await type(email(), "anna@example.com");
    await click(button("Dalej — potwierdź e-mail"));
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("/api/candidate/email-request", { method: "POST", json: { email: "anna@example.com" } });
  });

  it("replaces the single contact form with only a code form and submits its contact snapshot on verification", async () => {
    await renderRegistration();
    expect(host.querySelector("form form")).toBeNull();
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelectorAll("input")).toHaveLength(4);
    expect(contactField("name").value).toBe("Anna");
    await type(email(), "anna@example.com");
    await click(button("Dalej — potwierdź e-mail"));
    expect(host.querySelectorAll("form")).toHaveLength(1);
    expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(contactField("name")).toBeNull(); expect(email()).toBeNull();
    expect(document.activeElement).toBe(code());
    expect(host.textContent).toContain("folder „Spam”");
    mocks.api.mockResolvedValueOnce({ verified: true, contactCreated: true });
    await type(code(), "123456"); await click(button("Potwierdź i przejdź dalej"));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/candidate/email-verify", { method: "POST", json: { challengeId: "challenge-1", code: "123456", contact: validContact } });
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ contactCreated: true });
    expect(mocks.api.mock.calls.every(([url]) => String(url).startsWith("/api/candidate/email-"))).toBe(true);
  });

  it("keeps contact and email when going back, enforces the cooldown, and verifies only the updated draft", async () => {
    await renderRegistration(); await type(email(), "anna@example.com"); await click(button("Dalej — potwierdź e-mail"));
    await type(code(), "111111"); await click(button("Zmień dane"));
    for (const field of ["name", "phone", "telegram"] as const) expect(contactField(field).value).toBe(validContact[field]);
    expect(email().value).toBe("anna@example.com"); expect(code()).toBeNull();
    expect(button("Wyślij kod za 60 s").disabled).toBe(true);
    await click(button("Wyślij kod za 60 s")); expect(mocks.api).toHaveBeenCalledOnce();
    await type(contactField("name"), "Anna Nowak"); await type(email(), "nowak@example.com");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.api.mockResolvedValueOnce({ challengeId: "challenge-2", expiresIn: 600, resendAfter: 60 });
    await click(button("Dalej — potwierdź e-mail"));
    expect(code().value).toBe(""); expect(host.textContent).toContain("nowak@example.com");
    await type(code(), "222222"); await click(button("Potwierdź i przejdź dalej"));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/candidate/email-verify", { method: "POST", json: { challengeId: "challenge-2", code: "222222", contact: { ...validContact, name: "Anna Nowak" } } });
  });

  it("shows email-only login and never sends a registration contact to an existing-account verification", async () => {
    await renderRegistration(); await type(email(), "anna@example.com");
    await click(button("Masz już konto? Zaloguj się"));
    expect(contactField("name")).toBeNull(); expect(host.querySelectorAll("input")).toHaveLength(1);
    expect(email().value).toBe("anna@example.com");
    await click(button("Nowe zgłoszenie"));
    expect(contactField("name").value).toBe("Anna"); expect(email().value).toBe("anna@example.com");
    await click(button("Masz już konto? Zaloguj się")); await click(button("Wyślij kod"));
    await type(code(), "123456"); await click(button("Potwierdź i przejdź dalej"));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/candidate/email-verify", { method: "POST", json: { challengeId: "challenge-1", code: "123456" } });
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ contactCreated: false });
  });

  it("hides the old registration challenge when the header switches to login and cannot reuse its contact", async () => {
    await renderRegistration(); await type(email(), "anna@example.com"); await click(button("Dalej — potwierdź e-mail"));
    await type(code(), "111111"); await click(button("Header login"));
    expect(code()).toBeNull(); expect(contactField("name")).toBeNull();
    expect(email().value).toBe("anna@example.com");
    expect(button("Wyślij kod za 60 s").disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.api.mockResolvedValueOnce({ challengeId: "login-challenge", expiresIn: 600, resendAfter: 60 });
    await click(button("Wyślij kod"));
    expect(code().value).toBe("");
    await type(code(), "222222"); await click(button("Potwierdź i przejdź dalej"));
    expect(mocks.api).toHaveBeenLastCalledWith("/api/candidate/email-verify", { method: "POST", json: { challengeId: "login-challenge", code: "222222" } });
  });

  it("preserves registration details and the code after a server verification failure", async () => {
    await renderRegistration(); await type(email(), "anna@example.com"); await click(button("Dalej — potwierdź e-mail"));
    mocks.api.mockRejectedValueOnce(new Error("Kod jest nieprawidłowy lub wygasł."));
    await type(code(), "111111"); await click(button("Potwierdź i przejdź dalej"));
    expect(changed).not.toHaveBeenCalled(); expect(code().value).toBe("111111");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Kod jest nieprawidłowy");
    await click(button("Zmień dane"));
    for (const field of ["name", "phone", "telegram"] as const) expect(contactField(field).value).toBe(validContact[field]);
    expect(email().value).toBe("anna@example.com");
    expect(host.textContent).not.toContain("Kod jest nieprawidłowy");
  });

  it("blocks header mode changes until sending completes so the newly sent code remains visible", async () => {
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await renderRegistration(); await type(email(), "anna@example.com"); await click(button("Dalej — potwierdź e-mail"));
    expect(button("Header login").disabled).toBe(true);
    await click(button("Header login"));
    expect(contactField("name")).not.toBeNull();
    await act(async () => finish({ challengeId: "challenge-1", expiresIn: 600, resendAfter: 60 }));
    expect(code()).not.toBeNull(); expect(email()).toBeNull();
    expect(button("Header login").disabled).toBe(false);
    expect(host.textContent).toContain("anna@example.com");
  });

  it("re-enables header navigation after send failure and hides errors from the previous mode", async () => {
    await renderRegistration({ name: "", phone: "", telegram: "" });
    await click(button("Dalej — potwierdź e-mail"));
    expect(host.textContent).toContain("Sprawdź zaznaczone pola.");
    await click(button("Header login"));
    expect(host.textContent).not.toContain("Sprawdź zaznaczone pola.");
    await type(email(), "anna@example.com");
    mocks.api.mockRejectedValueOnce(new Error("Nie udało się wysłać kodu."));
    await click(button("Wyślij kod"));
    expect(button("Header login").disabled).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nie udało się wysłać kodu.");
    await click(button("Nowe zgłoszenie"));
    expect(host.textContent).not.toContain("Nie udało się wysłać kodu.");
  });

  it("requires six digits and prevents duplicate verification while a correct code is in flight", async () => {
    await renderRegistration(); await type(email(), "anna@example.com"); await click(button("Dalej — potwierdź e-mail"));
    await type(code(), "12a3"); await click(button("Potwierdź i przejdź dalej"));
    expect(code().value).toBe("123"); expect(mocks.api).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Wpisz 6-cyfrowy kod");
    let finish!: (result: unknown) => void;
    mocks.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await type(code(), "123456");
    await act(async () => { button("Potwierdź i przejdź dalej").click(); button("Potwierdź i przejdź dalej").click(); });
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(code().disabled).toBe(true); expect(button("Zmień dane").disabled).toBe(true);
    expect(button("Header login").disabled).toBe(true);
    await act(async () => finish({ verified: true, contactCreated: true }));
    expect(changed).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith({ contactCreated: true });
    expect(button("Header login").disabled).toBe(false);
  });

  it("keeps the ordinary contact flow available when email access is disabled", async () => {
    const onContinue = vi.fn();
    await act(async () => root.render(<StepContact contact={validContact} errors={{}} onChange={vi.fn()} saving={false} error={null} onContinue={onContinue} />));
    expect(host.querySelectorAll("form")).toHaveLength(1); expect(email()).toBeNull();
    expect(contactField("name").closest("fieldset[disabled]")).toBeNull();
    await click(button("Dalej →")); expect(onContinue).toHaveBeenCalledOnce();
  });

  it("does not fail if browser storage is unavailable during account changes", () => {
    const get = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("disabled"); });
    expect(clearCandidateDrafts).not.toThrow(); get.mockRestore();
  });
});
