"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { maintenanceEvent, maintenancePollIntervalMs } from "@/config/maintenance";
import { MaintenanceScreen } from "./MaintenanceScreen";

/** Proxy checks initial access; this gate closes already-open visitor tabs while APIs remain protected. */
export function SiteAccessGate({ children, initialMaintenance = false }: { children: React.ReactNode; initialMaintenance?: boolean }) {
  const [enabled, setEnabled] = useState(initialMaintenance);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const lastKnown = useRef(initialMaintenance);
  const revision = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const check = useCallback(async (manual = false) => {
    if (pending.current) {
      if (!manual) return;
      pending.current.abort();
    }
    const controller = new AbortController();
    pending.current = controller;
    const currentRevision = ++revision.current;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const response = await fetch("/api/maintenance", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || !("enabled" in data) || typeof data.enabled !== "boolean") throw new Error("Invalid status");
      if (controller.signal.aborted || currentRevision !== revision.current) return;

      if (!data.enabled && lastKnown.current) {
        lastKnown.current = false;
        // A server rewrite may have supplied the maintenance page at the original step URL.
        window.location.reload();
        return;
      }
      lastKnown.current = data.enabled;
      setEnabled(data.enabled);
      setNotice(manual && data.enabled ? "Prace nadal trwają. Dziękujemy za cierpliwość." : "");
    } catch {
      // A failed check must never reopen a site known to be closed.
      if (manual && (!controller.signal.aborted || timedOut) && currentRevision === revision.current) {
        setNotice("Nie udało się sprawdzić dostępności. Spróbuj ponownie.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = null;
        setChecking(false);
      }
    }
  }, []);

  const retry = () => {
    setChecking(true);
    setNotice("");
    return check(true);
  };

  useEffect(() => {
    const close = () => {
      revision.current += 1;
      pending.current?.abort();
      pending.current = null;
      lastKnown.current = true;
      setEnabled(true);
      setChecking(false);
    };
    const refresh = () => { if (document.visibilityState === "visible") void check(); };
    const initialCheck = window.setTimeout(() => void check(), 0);
    const interval = window.setInterval(refresh, maintenancePollIntervalMs);
    window.addEventListener(maintenanceEvent, close);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      revision.current += 1;
      pending.current?.abort();
      pending.current = null;
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      window.removeEventListener(maintenanceEvent, close);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [check]);

  return enabled
    ? <MaintenanceScreen onRetry={retry} checking={checking} notice={notice} />
    : children;
}
