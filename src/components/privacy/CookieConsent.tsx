"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cookieContent as copy } from "@/config/cookies";
import { COOKIE_CONSENT_EVENT, COOKIE_SETTINGS_EVENT, readCookieConsent, writeCookieConsent } from "@/lib/cookie-consent";
import { observeAttributionConsent } from "@/lib/attribution-consent-sync";

type ConsentSnapshot = "pending" | "unset" | "necessary" | "preferences";

function subscribeToConsent(onChange: () => void) {
  window.addEventListener(COOKIE_CONSENT_EVENT, onChange);
  window.addEventListener("focus", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener(COOKIE_CONSENT_EVENT, onChange);
    window.removeEventListener("focus", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

function getConsentSnapshot(): ConsentSnapshot {
  const consent = readCookieConsent();
  return consent ? (consent.preferences ? "preferences" : "necessary") : "unset";
}

function getServerSnapshot(): ConsentSnapshot {
  return "pending";
}

const choiceButton = "btn btn-ghost min-h-11 w-full border-paint/50 px-4 text-sm text-ink hover:border-paint sm:w-auto";

function ConsentChoices({ choose, banner = false }: { choose: (preferences: boolean) => void; banner?: boolean }) {
  const bannerButton = "btn min-h-14 w-full px-6 text-sm sm:w-auto sm:text-base";
  return (
    <>
      <button type="button" onClick={() => choose(false)} className={banner ? `${bannerButton} btn-ghost` : choiceButton}>
        {copy.necessaryOnly}
      </button>
      <button type="button" onClick={() => choose(true)} className={banner ? `${bannerButton} btn-primary` : choiceButton}>
        {copy.acceptAll}
      </button>
    </>
  );
}

function PolicyLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href={copy.policyHref}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      className={`underline decoration-paint/50 underline-offset-4 transition-colors hover:text-paint ${className}`}
    >
      {copy.policy}
    </Link>
  );
}

function VisitorCookieConsent() {
  const consent = useSyncExternalStore(subscribeToConsent, getConsentSnapshot, getServerSnapshot);
  const [preferences, setPreferences] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(observeAttributionConsent, []);

  const openSettings = useCallback(() => {
    setPreferences(readCookieConsent()?.preferences ?? false);
    setError("");
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  useEffect(() => {
    window.addEventListener(COOKIE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, openSettings);
  }, [openSettings]);

  function choose(nextPreferences: boolean) {
    try {
      writeCookieConsent(nextPreferences);
      setError("");
      setNotice(copy.saved);
      dialog.current?.close();
    } catch {
      setError(copy.saveError);
    }
  }

  return (
    <>
      <footer className="relative mx-auto max-w-[1400px] px-4 py-7 sm:px-8">
        <nav aria-label="Prywatność i pliki cookie" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-ink-soft">
          <PolicyLink />
          <button type="button" onClick={openSettings} className="min-h-10 underline decoration-line-strong underline-offset-4 transition-colors hover:text-paint">
            {copy.reopen}
          </button>
        </nav>
        <p role="status" className="sr-only">{notice}</p>
      </footer>

      {consent === "unset" ? (
        <section
          aria-label={copy.title}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-xl border-t border-line-strong bg-surface px-[22px] pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_#0006]"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold tracking-[0.1em] text-paint">{copy.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft md:text-base">
                {copy.description}{" "}
                <PolicyLink className="text-paint" />
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-1 gap-4 sm:flex">
              <ConsentChoices choose={choose} banner />
            </div>
          </div>
          {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
        </section>
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby="cookie-settings-title"
        aria-describedby="cookie-settings-description"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            event.currentTarget.close();
          }
        }}
        className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/75 backdrop:backdrop-blur-sm"
      >
        <div className="relative px-5 pt-6 sm:px-7">
          <button
            type="button"
            autoFocus
            aria-label={copy.close}
            onClick={() => dialog.current?.close()}
            className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
          <h2 id="cookie-settings-title" className="font-display pr-10 text-xl leading-tight font-bold sm:text-2xl">{copy.dialogTitle}</h2>
          <p id="cookie-settings-description" className="mt-3 text-sm leading-relaxed text-ink-soft">{copy.dialogDescription}</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            choose(preferences);
          }}
          className="px-5 pb-5 sm:px-7 sm:pb-7"
        >
          <div className="mt-5 rounded-xl border border-line bg-paper/40 p-4">
            <label className="flex items-center gap-3 text-sm font-bold">
              <input type="checkbox" checked disabled className="size-4 accent-paint" />
              <span>{copy.necessaryTitle}</span>
              <span className="ml-auto text-xs font-medium text-paint">{copy.alwaysOn}</span>
            </label>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">{copy.necessaryDescription}</p>
          </div>
          <div className="mt-3 rounded-xl border border-line bg-paper/40 p-4">
            <label htmlFor="cookie-preferences" className="flex min-h-7 cursor-pointer items-center gap-3 text-sm font-bold">
              <input id="cookie-preferences" type="checkbox" checked={preferences} onChange={(event) => setPreferences(event.target.checked)} className="size-4 accent-paint" aria-describedby="cookie-preferences-description" />
              <span>{copy.preferencesTitle}</span>
            </label>
            <p id="cookie-preferences-description" className="mt-2 text-xs leading-relaxed text-ink-soft">{copy.preferencesDescription}</p>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">{copy.noTracking} {copy.validity}</p>
          <p className="mt-3 text-xs text-ink"><PolicyLink /></p>
          {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ConsentChoices choose={choose} />
            <button type="submit" className="btn btn-primary mt-1 min-h-11 w-full px-4 text-sm sm:col-span-2">{copy.save}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function CookieConsent() {
  const pathname = usePathname();
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return null;
  return <VisitorCookieConsent />;
}
