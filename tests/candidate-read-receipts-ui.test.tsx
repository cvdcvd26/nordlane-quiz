// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage } from "@/lib/api";

let host: HTMLDivElement;
let root: Root;
let observer: ((entries: Partial<IntersectionObserverEntry>[]) => void) | undefined;
const read = vi.fn();
const message = (sequence: number, sender: ChatMessage["sender"]): ChatMessage => ({
  id: `message-${sequence}`, clientMessageId: `message-${sequence}`, sequence: String(sequence), sender,
  body: "Treść wiadomości", bodyRich: null, files: [], createdAt: "2026-11-01T09:00:00.000Z", changeRevision: 0,
});
const messages = [message(1, "admin"), message(2, "visitor"), message(3, "system")];
const show = async (active = true, viewer: "visitor" | "admin" = "visitor") => act(async () => {
  root.render(<MessageList messages={messages} viewer={viewer} emptyText="" onReadThrough={read} readTrackingActive={active} />);
});
const intersection = (visible: boolean) => act(async () => {
  observer?.([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
  await vi.advanceTimersByTimeAsync(1000);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof observer) { observer = callback; }
    observe() {}
    disconnect() {}
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  observer = undefined;
  read.mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("candidate notification read receipts", () => {
  it("does not count a mounted or polled chat as read before its end is visible", async () => {
    await show(); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(read).not.toHaveBeenCalled();
    await intersection(false); expect(read).not.toHaveBeenCalled();
    await intersection(true); expect(read).toHaveBeenCalledWith("1");
    // The later visitor message / automatic acknowledgement is never sent as the read cursor.
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not observe collapsed/inactive chat or admin viewers", async () => {
    await show(false); expect(observer).toBeUndefined();
    await show(true, "admin"); expect(observer).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });
  it("waits for the tab to become visible and cancels a pending receipt when closed", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await show(); await intersection(true); expect(read).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(500); });
    await show(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(read).not.toHaveBeenCalled();
    await show(true); await intersection(true); expect(read).toHaveBeenCalledWith("1");
  });
  it("checks again while visible so a failed request can retry without a new message", async () => {
    await show(); await intersection(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
