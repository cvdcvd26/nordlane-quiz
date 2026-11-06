"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Check, LockKeyhole, LogIn, LogOut, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { ContactFields, validateContact, type ContactDraft, type ContactErrors } from "./ContactFields";
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
  onAccessChanged: (result?: { contactCreated: boolean }) => void;
  registration?: {
    contact: ContactDraft;
    onChange: (next: ContactDraft, field: keyof ContactDraft) => void;
  };
  loginMode?: boolean;
  onLoginModeChange?: (login: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function CandidateEmailAccess({ state, existingApplication = false, onAccessChanged, registration, loginMode = false, onLoginModeChange, onBusyChange }: Props) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [storedChallengeId, setChallengeId] = useState<string | null>(null);
  const [challengeLoginMode, setChallengeLoginMode] = useState(loginMode);
  const challengeId = challengeLoginMode === loginMode ? storedChallengeId : null;
  const [sentTo, setSentTo] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<"request" | "verify" | "logout" | null>(null);
  const [errorState, setErrorState] = useState<{ message: string; loginMode: boolean } | null>(null);
  // Header navigation can switch the form externally. Do not carry a registration
  // validation error into email-only login (or a login error into registration).
  const error = errorState?.loginMode === loginMode ? errorState.message : null;
  const setError = (message: string | null) => setErrorState(message ? { message, loginMode } : null);
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const pendingContact = useRef<ContactDraft | null>(null);
  const inFlight = useRef(false);
  const registering = Boolean(registration && !loginMode);
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

  useEffect(() => {
    if (challengeId) codeInput.current?.focus();
  }, [challengeId]);

  // Sending may be disabled while an existing device session remains valid.
  // Keep its account/logout controls available, especially on shared devices.
  if (!state.enabled && !state.verified) return null;

  const requestCode = async () => {
    if (inFlight.current || Date.now() < resendAt) return;
    if (registering && registration) {
      const errors = validateContact(registration.contact);
      setContactErrors(errors);
      const firstBad = (Object.keys(errors) as (keyof ContactDraft)[])[0];
      if (firstBad) {
        setError("Sprawdź zaznaczone pola.");
        document.getElementById(`contact-${firstBad}`)?.focus();
        return;
      }
    }
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Wpisz poprawny adres e-mail.");
      document.getElementById(`${id}-email`)?.focus();
      return;
    }
    inFlight.current = true; setBusy("request"); onBusyChange?.(true); setError(null);
    try {
      const result = await api<{ challengeId: string; expiresIn: number; resendAfter: number }>("/api/candidate/email-request", {
        method: "POST", json: { email: normalized },
      });
      pendingContact.current = registering && registration ? { ...registration.contact } : null;
      setChallengeLoginMode(loginMode); setChallengeId(result.challengeId); setSentTo(normalized); setCode("");
      const time = Date.now(); setNow(time); setResendAt(time + Math.max(60, result.resendAfter) * 1000);
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); onBusyChange?.(false); }
  };

  const verifyCode = async () => {
    if (inFlight.current || !challengeId) return;
    if (!/^\d{6}$/.test(code)) { setError("Wpisz 6-cyfrowy kod z wiadomości e-mail."); return; }
    inFlight.current = true; setBusy("verify"); onBusyChange?.(true); setError(null);
    try {
      const result = await api<{ verified: true; contactCreated: boolean }>("/api/candidate/email-verify", { method: "POST", json: { challengeId, code, ...(pendingContact.current ? { contact: pendingContact.current } : {}) } });
      announceCandidateIdentityChange();
      onAccessChanged({ contactCreated: result.contactCreated });
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); onBusyChange?.(false); }
  };

  const logout = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("logout"); onBusyChange?.(true); setError(null);
    try {
      await api("/api/candidate/logout", { method: "POST" });
      announceCandidateIdentityChange();
      onAccessChanged();
    } catch (err) { setError((err as Error).message); }
    finally { inFlight.current = false; setBusy(null); onBusyChange?.(false); }
  };

  const editDetails = () => {
    if (inFlight.current) return;
    setChallengeId(null); setCode(""); setError(null); pendingContact.current = null;
  };
  const switchMode = (login: boolean) => {
    if (inFlight.current) return;
    editDetails(); setContactErrors({}); onLoginModeChange?.(login);
  };
  const emailField = <div className={registering ? "pb-6" : undefined}>
    <label htmlFor={`${id}-email`} className="block text-sm font-medium text-ink-soft">Adres e-mail <span className="text-danger" aria-hidden>*</span></label>
    <input id={`${id}-email`} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} disabled={Boolean(busy)} onChange={event => { setEmail(event.target.value); setError(null); }} className="field mt-1.5 block" placeholder="twoj@email.pl" aria-describedby={`${id}-privacy`} />
  </div>;

  return <section id="candidate-email-access" tabIndex={-1} aria-labelledby={`${id}-title`} className="glass scroll-mt-36 rounded-(--radius-tile) border border-paint/30 p-5 outline-none sm:p-7">
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
      <div className="flex min-w-0 items-start gap-3 sm:flex-1">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-paint/25 bg-paint/10 text-cyan">
          {state.verified ? <Check aria-hidden className="size-5" /> : challengeId ? <Mail aria-hidden className="size-5" /> : registering ? <LockKeyhole aria-hidden className="size-5" /> : <LogIn aria-hidden className="size-5" />}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-bold">{state.verified ? "Twoje konto" : challengeId ? "Potwierdź adres e-mail" : registering ? "Dane kontaktowe" : existingApplication ? "Zachowaj dostęp do zgłoszenia" : "Wróć do swojego zgłoszenia"}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{state.verified
            ? "Możesz wrócić do zgłoszenia i rozmowy z HR na dowolnym urządzeniu."
            : challengeId ? "Jeszcze jeden krok — wpisz kod z wiadomości e-mail."
            : registering ? "Wypełnij dane. Następnie potwierdzisz e-mail krótkim kodem."
            : existingApplication ? "Potwierdź e-mail, aby wrócić do tej rozmowy również na innym urządzeniu."
            : "Podaj e-mail użyty wcześniej. Kod pozwoli otworzyć Twoje zapisane zgłoszenie i czat z HR."}</p>
        </div>
      </div>
      {registration && !state.verified && !challengeId && registering && <button type="button" onClick={() => switchMode(true)} disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-cyan hover:bg-paint/10 disabled:opacity-50"><LogIn aria-hidden className="size-4" /><span>Masz już konto? Zaloguj się</span></button>}
    </div>

    {state.verified ? <div className="mt-5 space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span className="break-all font-semibold">{state.email}</span><span className="rounded-full bg-paint/10 px-2.5 py-1 text-xs font-semibold text-cyan">Potwierdzony e-mail</span></p>
      <p className="text-sm leading-relaxed text-ink-soft">Na ten adres otrzymasz powiadomienia o nowych, nieprzeczytanych wiadomościach od HR.</p>
      <p className="text-xs leading-relaxed text-ink-soft">Aby zalogować się ponownie, wybierz „Zaloguj się” i wpisz ten sam adres e-mail. Nie potrzebujesz hasła.</p>
      <button type="button" disabled={Boolean(busy)} onClick={() => void logout()} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-50"><LogOut aria-hidden className="size-4" />{busy === "logout" ? "Wylogowywanie…" : "Wyloguj się"}</button>
    </div> : <form className="mt-6 space-y-5" noValidate onSubmit={event => { event.preventDefault(); void (challengeId ? verifyCode() : requestCode()); }}>
      {challengeId ? <div>
        <p className="mb-5 text-sm leading-relaxed text-ink-soft" role="status">Kod wysłaliśmy na <span className="break-all font-semibold text-ink">{sentTo}</span>. Jest ważny przez 10 minut.</p>
        <label htmlFor={`${id}-code`} className="block text-sm font-semibold">Kod z wiadomości e-mail</label>
        <input ref={codeInput} id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={Boolean(busy)} className="field mt-2 block max-w-64 font-mono text-lg tracking-[0.3em]" placeholder="000000" aria-describedby={`${id}-spam${error ? ` ${id}-error` : ""}`} />
        <p id={`${id}-spam`} className="mt-4 text-sm leading-relaxed text-ink-soft">Jeśli nie widzisz wiadomości w skrzynce odbiorczej, sprawdź folder „Spam”.</p>
      </div> : registering && registration ? <fieldset disabled={Boolean(busy)}>
        <ContactFields value={registration.contact} errors={contactErrors} showTitle={false} emailField={emailField} onChange={(next, field) => {
          registration.onChange(next, field);
          if (contactErrors[field] && !validateContact(next)[field]) setContactErrors(previous => ({ ...previous, [field]: undefined }));
        }} />
      </fieldset> : emailField}
      <p id={`${id}-privacy`} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft"><LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>Twoje dane traktujemy poufnie. E-mail służy do logowania kodem, wiadomości powitalnej oraz powiadomień o rozmowie z HR. Są to wiadomości związane z obsługą zgłoszenia, nie marketing. Nie wysyłamy treści rozmów ani dokumentów e-mailem.</span></p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || (!challengeId && resendSeconds > 0)} aria-busy={busy === "request" || busy === "verify"}>{busy === "request" ? "Wysyłanie kodu…" : busy === "verify" ? "Potwierdzanie…" : challengeId ? "Potwierdź i przejdź dalej" : resendSeconds > 0 ? `Wyślij kod za ${resendSeconds} s` : registering ? "Dalej — potwierdź e-mail" : "Wyślij kod"}</button>
        {challengeId && <>
          <button type="button" className="min-h-10 text-sm font-semibold text-cyan disabled:text-ink-soft" disabled={Boolean(busy) || resendSeconds > 0} onClick={() => void requestCode()}>{resendSeconds > 0 ? `Wyślij ponownie za ${resendSeconds} s` : "Wyślij kod ponownie"}</button>
          <button type="button" disabled={Boolean(busy)} className="inline-flex min-h-10 items-center gap-2 text-sm text-ink-soft underline underline-offset-4" onClick={editDetails}><ArrowLeft aria-hidden className="size-4" />{registering ? "Zmień dane" : "Zmień adres"}</button>
        </>}
        {registration && !challengeId && !registering && <button type="button" disabled={Boolean(busy)} onClick={() => switchMode(false)} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft aria-hidden className="size-4" />Nowe zgłoszenie</button>}
      </div>
    </form>}
    {error && <p id={`${id}-error`} role="alert" className="mt-4 text-sm text-danger">{error}</p>}
  </section>;
}
