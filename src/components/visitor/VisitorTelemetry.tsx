"use client";
import { useEffect, useRef } from "react";
import { analyticsConfig } from "@/config/analytics";
import { api } from "@/lib/api";
import { retryAttributionConsent, syncAttributionAfterSessionReady } from "@/lib/attribution-consent-sync";

/** Operational presence uses the existing session only; campaign data requires optional consent. */
export function VisitorTelemetry({ ready, step }: { ready: boolean; step: number }) {
  const taskViewed = useRef(false);
  const lastHeartbeat = useRef(0);

  useEffect(() => {
    if (ready) void syncAttributionAfterSessionReady();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let pending = false;
    let cancelled = false;
    const heartbeat = () => {
      if (document.visibilityState !== "visible" || pending) return;
      void retryAttributionConsent();
      const viewTask = step === 2 && !taskViewed.current;
      if (!viewTask && Date.now() - lastHeartbeat.current < analyticsConfig.heartbeatIntervalMs) return;
      lastHeartbeat.current = Date.now();
      pending = true;
      void api("/api/visitor/activity", { method: "POST", json: { visible: true, taskViewed: viewTask } })
        .then(() => { if (!cancelled && viewTask) taskViewed.current = true; })
        .catch(() => { /* Retry on the next visible heartbeat. */ })
        .finally(() => { pending = false; });
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, analyticsConfig.heartbeatIntervalMs);
    document.addEventListener("visibilitychange", heartbeat);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", heartbeat); };
  }, [ready, step]);
  return null;
}
