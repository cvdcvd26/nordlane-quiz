// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceCandidateIdentityChange, candidateIdentityIsCurrent, CANDIDATE_IDENTITY_KEY, observeCandidateIdentity } from "@/lib/candidate-identity";
import { api, uploadWithProgress } from "@/lib/api";

const A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
let dispose: (() => void) | undefined;

class Channel {
  static all = new Set<Channel>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) { Channel.all.add(this); }
  postMessage(data: unknown) {
    for (const peer of Channel.all) if (peer !== this && peer.name === this.name) peer.onmessage?.(new MessageEvent("message", { data }));
  }
  close() { Channel.all.delete(this); }
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
});
afterEach(() => { dispose?.(); dispose = undefined; Channel.all.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function observe(changed = vi.fn()) {
  const monitor = observeCandidateIdentity(changed);
  dispose = monitor.dispose;
  return { changed, ...monitor };
}
function draft() {
  sessionStorage.setItem("nl_review_draft", "Previous applicant's draft");
  sessionStorage.setItem("nl_submit_key", "old-key");
  sessionStorage.setItem("nl_revision_draft_7", "Previous correction");
  sessionStorage.setItem("unrelated", "preserve");
}

describe("candidate identity across tabs", () => {
  it("does not reload or write a shared marker for the existing anonymous flow", () => {
    const monitor = observe();
    expect(monitor.isCurrent()).toBe(true);
    window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow"));
    expect(monitor.changed).not.toHaveBeenCalled();
    expect(localStorage.getItem(CANDIDATE_IDENTITY_KEY)).toBeNull();
  });

  it("announces only a random generation, clears private drafts and ignores its own broadcast", () => {
    const monitor = observe(); draft();
    announceCandidateIdentityChange();
    const generation = localStorage.getItem(CANDIDATE_IDENTITY_KEY);
    expect(generation).toMatch(/^[a-f0-9-]{36}$/);
    expect(Object.keys(localStorage)).toEqual([CANDIDATE_IDENTITY_KEY]);
    expect(sessionStorage.getItem("nl_review_draft")).toBeNull();
    expect(sessionStorage.getItem("nl_submit_key")).toBeNull();
    expect(sessionStorage.getItem("nl_revision_draft_7")).toBeNull();
    expect(sessionStorage.getItem("unrelated")).toBe("preserve");
    expect(monitor.isCurrent()).toBe(true); expect(monitor.changed).not.toHaveBeenCalled();
  });

  it("invalidates another tab once before reload and does not repeat after reloading", () => {
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, A);
    const monitor = observe(); draft();
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    window.dispatchEvent(new StorageEvent("storage", { key: CANDIDATE_IDENTITY_KEY, newValue: B }));
    window.dispatchEvent(new Event("focus"));
    expect(monitor.changed).toHaveBeenCalledOnce(); expect(monitor.isCurrent()).toBe(false);
    expect(sessionStorage.getItem("nl_review_draft")).toBeNull();
    monitor.dispose();
    const restored = observe();
    expect(restored.isCurrent()).toBe(true); expect(restored.changed).not.toHaveBeenCalled();
  });

  it("detects a missed event before a suspended tab can restore its old draft", () => {
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, A);
    observe().dispose(); draft();
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    const restored = observe();
    expect(restored.isCurrent()).toBe(false); expect(restored.changed).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("nl_review_draft")).toBeNull();
  });

  it.each(["focus", "pageshow", "visibilitychange"])("checks the shared generation on %s even without a storage event", event => {
    const monitor = observe(); draft();
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
    expect(monitor.changed).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("nl_review_draft")).toBeNull();
  });

  it("blocks stale visitor mutations before sending while leaving admin and auth requests alone", async () => {
    const monitor = observe();
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    await expect(api("/api/contact", { method: "PUT", json: { name: "Old draft" } })).rejects.toMatchObject({ code: "candidate_identity_changed" });
    expect(fetch).not.toHaveBeenCalled(); expect(monitor.changed).toHaveBeenCalledOnce();
    await expect(api("/api/admin/leads")).resolves.toEqual({ ok: true });
    await expect(api("/api/candidate/email-verify", { method: "POST" })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("discards an in-flight chat response after the shared account changes", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const monitor = observe();
    const request = api("/api/chat");
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    finish(new Response(JSON.stringify({ messages: ["Other account's message"] })));
    await expect(request).rejects.toMatchObject({ code: "candidate_identity_changed" });
    expect(monitor.changed).toHaveBeenCalledOnce();
  });

  it("blocks stale uploads before constructing the request", async () => {
    observe();
    localStorage.setItem(CANDIDATE_IDENTITY_KEY, B);
    const xhr = vi.fn(); vi.stubGlobal("XMLHttpRequest", xhr);
    await expect(uploadWithProgress("/api/chat/uploads", new FormData(), vi.fn()).promise).rejects.toMatchObject({ code: "candidate_identity_changed" });
    expect(xhr).not.toHaveBeenCalled();
  });

  it("uses broadcasts without forcing reload loops when storage is unavailable", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("disabled"); });
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("disabled"); });
    const monitor = observe();
    announceCandidateIdentityChange();
    window.dispatchEvent(new Event("focus"));
    expect(candidateIdentityIsCurrent()).toBe(true); expect(monitor.changed).not.toHaveBeenCalled();
    const otherTab = new Channel("alleybiz-candidate-identity");
    otherTab.postMessage(B);
    expect(monitor.changed).toHaveBeenCalledOnce();
    monitor.dispose();
    const restored = observe();
    expect(restored.isCurrent()).toBe(true); expect(restored.changed).not.toHaveBeenCalled();
  });
});
