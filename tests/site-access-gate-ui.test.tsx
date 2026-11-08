// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteAccessGate } from "@/components/maintenance/SiteAccessGate";
import { maintenanceEvent, maintenancePollIntervalMs } from "@/config/maintenance";

const fetchStatus = vi.fn<typeof fetch>();
const visitorMounted = vi.fn();
let host: HTMLDivElement;
let root: Root;
let reload: ReturnType<typeof vi.spyOn>;

function VisitorContent() {
  useEffect(() => { visitorMounted(); }, []);
  return <form data-visitor-form><input aria-label="Imię" /></form>;
}

const tree = (initialMaintenance = false) => <SiteAccessGate initialMaintenance={initialMaintenance}><VisitorContent /></SiteAccessGate>;
const render = (initialMaintenance = false) => act(async () => root.render(tree(initialMaintenance)));
const visitor = () => host.querySelector("[data-visitor-form]");
const maintenance = () => host.querySelector("[data-maintenance-screen]");
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const statusResponse = (enabled: boolean) => new Response(JSON.stringify({ enabled }), {
  headers: { "Content-Type": "application/json" },
});

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchStatus);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
  fetchStatus.mockReset();
  visitorMounted.mockReset();
  fetchStatus.mockResolvedValue(statusResponse(false));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("visitor maintenance gate", () => {
  it("prerenders and mounts permitted content before the background availability request completes", async () => {
    const pending = pendingResponse();
    fetchStatus.mockReturnValue(pending.promise);
    const html = renderToString(tree());
    expect(html).toContain("data-visitor-form");
    expect(html).not.toContain("Sprawdzamy dostępność");
    expect(fetchStatus).not.toHaveBeenCalled();

    await render();
    expect(visitor()).not.toBeNull();
    expect(visitorMounted).toHaveBeenCalledOnce();
    await tick();
    expect(fetchStatus).toHaveBeenCalledExactlyOnceWith("/api/maintenance", expect.objectContaining({ cache: "no-store" }));
    expect(visitor()).not.toBeNull();
    expect(maintenance()).toBeNull();
  });

  it("keeps initial maintenance visible without mounting visitor content", async () => {
    const pending = pendingResponse();
    fetchStatus.mockReturnValue(pending.promise);
    expect(renderToString(tree(true))).toContain("data-maintenance-screen");
    await render(true);
    await tick();
    expect(maintenance()).not.toBeNull();
    expect(visitor()).toBeNull();
    expect(visitorMounted).not.toHaveBeenCalled();
    await act(async () => pending.resolve(statusResponse(true)));
    expect(maintenance()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("closes permitted content immediately when a visitor API reports maintenance", async () => {
    await render();
    await tick();
    expect(visitor()).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event(maintenanceEvent)); });
    expect(visitor()).toBeNull();
    expect(maintenance()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("closes an already-open page when the next background poll reports maintenance", async () => {
    await render();
    await tick();
    expect(visitor()).not.toBeNull();
    fetchStatus.mockResolvedValue(statusResponse(true));
    await tick(maintenancePollIntervalMs);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(visitor()).toBeNull();
    expect(maintenance()).not.toBeNull();
  });

  it("does not reopen or reload after an older open response arrives following a maintenance event", async () => {
    const pending = pendingResponse();
    fetchStatus.mockReturnValue(pending.promise);
    await render();
    await tick();
    const signal = fetchStatus.mock.calls[0][1]?.signal;
    await act(async () => { window.dispatchEvent(new Event(maintenanceEvent)); });
    expect(signal?.aborted).toBe(true);
    // Simulate a response whose transport ignores cancellation.
    await act(async () => pending.resolve(statusResponse(false)));
    expect(visitor()).toBeNull();
    expect(maintenance()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps a closed site closed when automatic checks and a manual retry fail", async () => {
    fetchStatus.mockRejectedValue(new Error("Network unavailable"));
    await render(true);
    await tick();
    expect(visitor()).toBeNull();
    expect(maintenance()).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Nie udało się sprawdzić dostępności");
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    expect(visitorMounted).not.toHaveBeenCalled();
    expect(maintenance()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads the server route when maintenance ends instead of mounting a stale visitor page", async () => {
    await render(true);
    await tick();
    expect(reload).toHaveBeenCalledOnce();
    expect(maintenance()).not.toBeNull();
    expect(visitorMounted).not.toHaveBeenCalled();
  });
});
