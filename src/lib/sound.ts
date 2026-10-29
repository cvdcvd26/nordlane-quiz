"use client";
import { clearVisitorSoundPreference, readCookieConsent, VISITOR_SOUND_KEY } from "./cookie-consent";

/**
 * Short notification chime generated with Web Audio (no audio files to host).
 * Browsers only allow audio after a user gesture, so the context is unlocked on the first
 * click/keypress and the chime is silently skipped until then.
 */
let ctx: AudioContext | null = null;
let unlockBound = false;

function context() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** Call once on mount: resumes the audio context on the first user interaction. */
export function bindAudioUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const unlock = () => {
    const c = context();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    if (c?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

const KEY_PREFIX = "nl-sound-";
export const SOUND_PREFERENCE_EVENT = "alleybiz:sound-preference";
export type SoundPreferenceChange = { scope: "visitor" | "admin"; on: boolean };

export function isSoundEnabled(scope: "visitor" | "admin") {
  if (scope === "visitor" && !readCookieConsent()?.preferences) {
    clearVisitorSoundPreference();
    return true;
  }
  try {
    return window.localStorage.getItem(KEY_PREFIX + scope) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(scope: "visitor" | "admin", on: boolean) {
  // Keep listeners on this page in sync even when optional preference storage is off.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<SoundPreferenceChange>(SOUND_PREFERENCE_EVENT, { detail: { scope, on } }));
  // Sound itself still works with necessary-only cookies; only remembering the choice is optional.
  if (scope === "visitor" && !readCookieConsent()?.preferences) {
    clearVisitorSoundPreference();
    return;
  }
  try {
    window.localStorage.setItem(scope === "visitor" ? VISITOR_SOUND_KEY : KEY_PREFIX + scope, on ? "on" : "off");
  } catch {
    /* storage unavailable: setting lasts for this page only */
  }
}

let lastPlayed = 0;

/** Two soft rising tones. Throttled so a burst of messages plays one chime. */
export function playChime(kind: "message" | "lead" | "revision" = "message") {
  const now = Date.now();
  if (now - lastPlayed < 800) return;
  const c = context();
  if (!c || c.state !== "running") return;
  lastPlayed = now;

  const notes = kind === "lead" ? [659.25, 880, 1174.66] : kind === "revision" ? [698.46, 880] : [880, 1318.51];
  const t0 = c.currentTime + 0.01;
  notes.forEach((freq, i) => {
    const start = t0 + i * 0.11;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(kind === "revision" ? 0.12 : 0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + 0.45);
  });
}
