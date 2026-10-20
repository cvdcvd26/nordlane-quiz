"use client";

import { openCookieSettings } from "@/lib/cookie-consent";

export function CookieSettingsButton() {
  return <button type="button" className="btn btn-primary" onClick={openCookieSettings}>Zmień ustawienia cookies</button>;
}
