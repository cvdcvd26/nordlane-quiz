"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { getAdminThemeSnapshot, getServerAdminThemeSnapshot, setAdminTheme, subscribeAdminTheme } from "@/config/admin-theme";
import { useAdminI18n } from "./i18n";

const copy = {
  pl: { label: "Ciemny motyw", light: "Włącz jasny motyw", dark: "Włącz ciemny motyw" },
  ru: { label: "Тёмная тема", light: "Включить светлую тему", dark: "Включить тёмную тему" },
  en: { label: "Dark theme", light: "Switch to light theme", dark: "Switch to dark theme" },
} as const;

export function useAdminTheme() {
  return useSyncExternalStore(subscribeAdminTheme, getAdminThemeSnapshot, getServerAdminThemeSnapshot);
}

export function AdminThemeToggle() {
  const theme = useAdminTheme();
  const { lang } = useAdminI18n();
  const t = copy[lang];
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label={t.label}
      title={theme === "dark" ? t.light : t.dark}
      onClick={() => setAdminTheme(theme === "dark" ? "light" : "dark")}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-adm-line-strong bg-adm-surface text-adm-ink-2 transition-colors hover:bg-adm-subtle hover:text-adm-ink"
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.8} />
    </button>
  );
}
