"use client";
import { useEffect, useRef, useState } from "react";
import { bindAudioUnlock, isSoundEnabled, playChime, setSoundEnabled, SOUND_PREFERENCE_EVENT, type SoundPreferenceChange } from "@/lib/sound";
import { COOKIE_CONSENT_EVENT } from "@/lib/cookie-consent";

/** Speaker button that mutes/unmutes notification chimes; the choice is remembered in this browser. */
export function SoundToggle({
  scope,
  labelOn,
  labelOff,
  onChange,
  className = "",
  appearance = "visitor",
}: {
  scope: "visitor" | "admin";
  labelOn: string;
  labelOff: string;
  onChange?: (on: boolean) => void;
  className?: string;
  appearance?: "visitor" | "admin";
}) {
  const [on, setOn] = useState(true);
  const onRef = useRef(true);
  useEffect(() => {
    bindAudioUnlock();
    const v = isSoundEnabled(scope);
    // Read the stored preference after mount (localStorage is not available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(v);
    onRef.current = v;
    onChange?.(v);
    const rememberChoice = () => { if (scope === "visitor") setSoundEnabled(scope, onRef.current); };
    const syncChoice = (event: Event) => {
      const detail = (event as CustomEvent<SoundPreferenceChange>).detail;
      if (detail?.scope !== scope) return;
      onRef.current = detail.on;
      setOn(detail.on);
      onChange?.(detail.on);
    };
    window.addEventListener(COOKIE_CONSENT_EVENT, rememberChoice);
    window.addEventListener(SOUND_PREFERENCE_EVENT, syncChoice);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_EVENT, rememberChoice);
      window.removeEventListener(SOUND_PREFERENCE_EVENT, syncChoice);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const toggle = () => {
    const next = !on;
    onRef.current = next;
    setOn(next);
    setSoundEnabled(scope, next);
    onChange?.(next);
    if (next) playChime("message");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? labelOn : labelOff}
      title={on ? labelOn : labelOff}
      className={
        appearance === "admin"
          ? `inline-flex size-8 items-center justify-center rounded-md border border-adm-line-strong bg-adm-surface text-adm-ink-2 transition-colors hover:bg-adm-subtle hover:text-adm-ink ${className}`
          : `inline-flex size-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-line-strong hover:text-ink ${className}`
      }
    >
      <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
        {on ? (
          <>
            <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
            <path d="M18.2 6.5a8 8 0 0 1 0 11" />
          </>
        ) : (
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        )}
      </svg>
    </button>
  );
}
