"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { adminDicts, ADMIN_LANGS, isAdminLang, translateServerMessage, type AdminLang } from "@/config/admin-i18n";
import { uploadConfig } from "@/config/settings";
import { ApiError, formatTime } from "@/lib/api";

const KEY = "nl-admin-lang";
const listeners = new Set<() => void>();
let current: AdminLang | null = null;

/** Saved choice, otherwise the browser language (Polish → PL, Russian/Ukrainian/Belarusian → RU, else EN). */
function detect(): AdminLang {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (isAdminLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = (navigator.languages?.[0] ?? navigator.language ?? "").toLowerCase();
  if (nav.startsWith("pl")) return "pl";
  if (/^(ru|uk|be)/.test(nav)) return "ru";
  return "en";
}

const getSnapshot = () => (current ??= detect());
const getServerSnapshot = (): AdminLang => "pl";
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function setAdminLang(lang: AdminLang) {
  current = lang;
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    /* remembered for this page only */
  }
  listeners.forEach((l) => l());
}

/** Current admin language with its dictionary and helpers. */
export function useAdminI18n() {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return useMemo(() => {
    const t = adminDicts[lang];
    const maxMb = Math.round(uploadConfig.maxFileSizeBytes / 1024 / 1024);
    return {
      lang,
      t,
      time: (iso: string) => formatTime(iso, t.locale),
      /** Error text in the panel language. */
      err: (e: unknown) => {
        if (e instanceof ApiError) {
          if (e.code === "network") return t.errors.network;
          if (e.code === "file_size") return t.errors.fileSize(maxMb);
          if (e.code === "file_count") return t.errors.fileCount(uploadConfig.maxFilesPerMessage);
        }
        return translateServerMessage(e instanceof Error ? e.message : String(e), lang);
      },
    };
  }, [lang]);
}

/** PL / RU / EN segmented switch. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, t } = useAdminI18n();
  return (
    <div role="group" aria-label={t.langSwitch} className={`inline-flex rounded-full border border-line p-0.5 text-xs font-semibold ${className}`}>
      {ADMIN_LANGS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setAdminLang(l)}
          className={`rounded-full px-2.5 py-1 transition ${lang === l ? "bg-paint text-on-paint" : "text-slate hover:text-ink"}`}
        >
          {adminDicts[l].langName}
        </button>
      ))}
    </div>
  );
}
