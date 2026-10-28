"use client";

import { useSyncExternalStore } from "react";
import { isHalloweenSeason } from "@/config/halloween";
import { HalloweenDecor } from "./HalloweenDecor";

function subscribeToCalendar(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

// Keep server HTML and the first client render identical; decoration appears after hydration.
const serverSnapshot = () => false;

export function HalloweenSeason({ hidden = false }: { hidden?: boolean }) {
  const active = useSyncExternalStore(subscribeToCalendar, isHalloweenSeason, serverSnapshot);
  return active && !hidden ? <HalloweenDecor /> : null;
}
