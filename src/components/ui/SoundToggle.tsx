"use client";
import { useEffect, useState } from "react";
import { bindAudioUnlock, isSoundEnabled, playChime, setSoundEnabled } from "@/lib/sound";

/** Speaker button that mutes/unmutes notification chimes; the choice is remembered in this browser. */
export function SoundToggle({
  scope,
  labelOn,
  labelOff,
  onChange,
  className = "",
}: {
  scope: "visitor" | "admin";
  labelOn: string;
  labelOff: string;
  onChange?: (on: boolean) => void;
  className?: string;
}) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    bindAudioUnlock();
    const v = isSoundEnabled(scope);
    // Read the stored preference after mount (localStorage is not available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(v);
    onChange?.(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const toggle = () => {
    const next = !on;
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
      className={`inline-flex size-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-line-strong hover:text-ink ${className}`}
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
