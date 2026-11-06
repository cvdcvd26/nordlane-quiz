"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LockKeyhole, LogOut, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { announceCandidateIdentityChange } from "@/lib/candidate-identity";
export { clearCandidateDrafts } from "@/lib/candidate-identity";

export type CandidateEmailState = {
  enabled: boolean;
  email: string | null;
  verified: boolean;
};

type Props = {
  state: CandidateEmailState;
  existingApplication?: boolean;
  onAccessChanged: () => void;
};

export function CandidateEmailAccess({ state, existingApplication = false, onAccessChanged }: Props) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<"request" | "verify" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (!resendAt) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  // Sending may be disabled while an existing device session remains valid.
  // Keep its account/logout controls available, especially on shared devices.
  if (!state.enabled && !state.verified) return null;

  const requestCode = async () => {
    if (inFlight.current || (challengeId && Date.now() < resendAt)) return;
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Wpisz poprawny adres e-mail.");
      return;
    }
    inFlight.current = true; setBusy("request"); setError(null);
    try {
      const result = await api<{ challengeId: string; expiresIn: number; resendAfter: number }>("/api/candidate/email-request", {
        method: "POST", json: { email: normalized },
      });
      setChallengeId(result.challengeId); setSentTo(normalized); setCode("");
      const time = Date.now(); setNow(time); setResendAt(time + Math.max(60, result.resendAfter) * 1000);
      requestAnimationFrame(() => codeInput.current?.focus());
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); }
  };

  const verifyCode = async () => {
    if (inFlight.current || !challengeId) return;
    if (!/^\d{6}$/.test(code)) { setError("Wpisz 6-cyfrowy kod z wiadomości e-mail."); return; }
    inFlight.current = true; setBusy("verify"); setError(null);
    try {
      await api("/api/candidate/email-verify", { method: "POST", json: { challengeId, code } });
      announceCandidateIdentityChange();
      onAccessChanged();
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); }
  };

  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("logout"); setError(null);
    try {
      await api("/api/candidate/logout", { method: "POST" });
      announceCandidateIdentityChange();
      onAccessChanged();
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); }
  };

  return <section id="candidate-email-access" tabIndex={-1} aria-labelledby={`${id}-title`} className="glass scroll-mt-36 rounded-(--radius-tile) border border-paint/30 p-5 outline-none sm:p-7">
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-paint/25 bg-paint/10 text-cyan">
        {state.verified ? <Check aria-hidden className="size-5" /> : <Mail aria-hidden className="size-5" />}
      </span>
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-lg font-bold">{state.verified ? "Twoje konto" : "Dostęp do Twojego zgłoszenia"}</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{state.verified
          ? "Możesz wrócić do zgłoszenia i rozmowy z HR na dowolnym urządzeniu."
          : existingApplication
            ? "Potwierdź e-mail, aby zachować dostęp do tego zgłoszenia również na innym urządzeniu."
            : "Podaj e-mail i potwierdź go kodem. Jeśli masz już konto, otworzymy Twoje zapisane zgłoszenie."}</p>
      </div>
    </div>

    {state.verified ? <div className="mt-5 space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span className="break-all font-semibold">{state.email}</span><span className="rounded-full bg-paint/10 px-2.5 py-1 text-xs font-semibold text-cyan">Potwierdzony e-mail</span></p>
      <p className="text-sm leading-relaxed text-ink-soft">Powiadomienia o nieprzeczytanych wiadomościach od HR wysyłamy po 30 minutach bez odczytu, nie częściej niż raz na 3 godziny. Kilka wiadomości łączymy w jedno powiadomienie.</p>
      <p className="text-xs leading-relaxed text-ink-soft">Aby zalogować się ponownie, wybierz „Moje zgłoszenie” i wpisz ten sam adres e-mail. Nie potrzebujesz hasła.</p>
      <button type="button" disabled={Boolean(busy)} onClick={() => void logout()} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-50"><LogOut aria-hidden className="size-4" />{busy === "logout" ? "Wylogowywanie…" : "Wyloguj się"}</button>
    </div> : <form className="mt-5 space-y-4" noValidate onSubmit={event => { event.preventDefault(); void (challengeId ? verifyCode() : requestCode()); }}>
      <div>
        <label htmlFor={`${id}-email`} className="text-sm font-semibold">Adres e-mail</label>
        <input id={`${id}-email`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} disabled={Boolean(busy) || Boolean(challengeId)} onChange={event => setEmail(event.target.value)} className="field mt-2" placeholder="twoj@email.pl" aria-describedby={`${id}-privacy`} />
      </div>
      {challengeId && <div>
        <p className="mb-3 text-sm leading-relaxed text-ink-soft" role="status">Kod wysłaliśmy na <span className="break-all text-ink">{sentTo}</span>. Jest ważny przez 10 minut. Sprawdź również folder spam.</p>
        <label htmlFor={`${id}-code`} className="text-sm font-semibold">Kod z wiadomości e-mail</label>
        <input ref={codeInput} id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={Boolean(busy)} className="field mt-2 max-w-64 font-mono text-lg tracking-[0.3em]" placeholder="000000" aria-describedby={error ? `${id}-error` : undefined} />
      </div>}
      <p id={`${id}-privacy`} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft"><LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>Adres e-mail służy do logowania kodem, wiadomości powitalnej z linkiem do zgłoszenia oraz powiadomień o nieprzeczytanych wiadomościach od HR. Powiadomienie wysyłamy po 30 minutach bez odczytu, nie częściej niż raz na 3 godziny. Są to wiadomości związane z obsługą zgłoszenia, nie marketing. Nie wysyłamy treści rozmów ani dokumentów e-mailem.</span></p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy)} aria-busy={busy === "request" || busy === "verify"}>{busy === "request" ? "Wysyłanie kodu…" : busy === "verify" ? "Potwierdzanie…" : challengeId ? "Potwierdź i przejdź dalej" : "Wyślij kod"}</button>
        {challengeId && <>
          <button type="button" className="min-h-10 text-sm font-semibold text-cyan disabled:text-ink-soft" disabled={Boolean(busy) || resendSeconds > 0} onClick={() => void requestCode()}>{resendSeconds > 0 ? `Wyślij ponownie za ${resendSeconds} s` : "Wyślij kod ponownie"}</button>
          <button type="button" disabled={Boolean(busy)} className="min-h-10 text-sm text-ink-soft underline underline-offset-4" onClick={() => { setChallengeId(null); setCode(""); setError(null); }}>Zmień adres</button>
        </>}
      </div>
    </form>}
    {error && <p id={`${id}-error`} role="alert" className="mt-4 text-sm text-danger">{error}</p>}
  </section>;
}
