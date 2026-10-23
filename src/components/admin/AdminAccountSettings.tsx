"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { adminAccountCopy, adminAccountUpdatedEvent } from "@/config/admin-account";
import { api, ApiError } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";

type Account = { email: string; isTemporary: boolean };

/** The owner form is never rendered until the server confirms the account's capability. */
export default function AdminAccountSettings() {
  const { lang, t, err: tErr } = useAdminI18n();
  const C = adminAccountCopy[lang];
  const P = t.ui.settings.password;
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{ admin: Account }>("/api/admin/me", { signal: controller.signal })
      .then(({ admin }) => {
        if (controller.signal.aborted) return;
        if (typeof admin.isTemporary !== "boolean") { setLoadFailed(true); return; }
        setAccount(admin);
        setEmail(admin.email);
        setLoadFailed(false);
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace("/admin/login");
        else setLoadFailed(true);
      });
    return () => controller.abort();
  }, [reload, router]);

  useEffect(() => () => saveController.current?.abort(), []);

  if (loadFailed) return (
    <div className="adm-panel mt-4 flex flex-wrap items-center gap-3 px-4 py-3">
      <p role="alert" className="text-[13px] text-adm-red">{C.loadError}</p>
      <button type="button" className="adm-btn ml-auto" onClick={() => { setLoadFailed(false); setReload(value => value + 1); }}>{C.retry}</button>
    </div>
  );
  if (!account) return null;
  const main = account.isTemporary === false;

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    setError(null);
    setSaved(false);
    if (pw.newPassword !== pw.repeat) { setError(P.mismatch); return; }
    const controller = new AbortController();
    saveController.current = controller;
    saving.current = true;
    setBusy(true);
    try {
      const result = await api<{ email?: string }>(main ? "/api/admin/account" : "/api/admin/password", {
        method: main ? "PUT" : "POST", signal: controller.signal,
        json: { currentPassword: pw.currentPassword, newPassword: pw.newPassword, ...(main ? { email } : {}) },
      });
      if (controller.signal.aborted) return;
      setPw({ currentPassword: "", newPassword: "", repeat: "" });
      if (main && result.email) {
        setEmail(result.email);
        setAccount({ ...account, email: result.email });
        window.dispatchEvent(new Event(adminAccountUpdatedEvent));
      }
      setSaved(true);
      toast({ kind: "success", title: main ? C.saved : P.changed });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError) {
        if (cause.status === 401) { router.replace("/admin/login"); return; }
        if (main && cause.status === 403) { setAccount(null); setPw({ currentPassword: "", newPassword: "", repeat: "" }); return; }
        if (cause.code === "admin_email_in_use") { setError(C.emailUsed); return; }
        if (cause.code === "password_unchanged") { setError(C.differentPassword); return; }
        if (cause.code === "main_access_failed") { setError(C.failed); return; }
        if (main && cause.code === "network") { setError(C.network); return; }
      }
      setError(tErr(cause));
    } finally {
      saving.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <section className="adm-panel mt-4" aria-labelledby="admin-account-title" aria-busy={busy}>
      <form onSubmit={save}>
        <div className="grid gap-x-8 gap-y-3 px-4 py-5 md:grid-cols-[240px_1fr]">
          <div>
            <h2 id="admin-account-title" className="adm-section-title flex items-center gap-2">
              <KeyRound size={16} className="text-adm-ink-3" aria-hidden="true" />
              {main ? C.title : P.title}
            </h2>
            {main && <p id="admin-account-description" className="adm-help mt-1">{C.intro}</p>}
          </div>
          <fieldset className="min-w-0 max-w-sm space-y-3" disabled={busy}>
            {main && <label className="adm-label block" htmlFor="admin-account-email">
              {C.email}
              <input id="admin-account-email" name="username" type="email" autoComplete="username" required maxLength={254} className="adm-input mt-1.5" value={email} onChange={event => { setEmail(event.target.value); setSaved(false); }} aria-describedby="admin-account-email-hint" />
              <span id="admin-account-email-hint" className="adm-help mt-1 block">{C.emailHint}</span>
            </label>}
            {([
              ["currentPassword", P.current, "current-password"],
              ["newPassword", P.next, "new-password"],
              ["repeat", P.repeat, "new-password"],
            ] as const).map(([key, label, autoComplete]) => <label key={key} className="adm-label block" htmlFor={`admin-account-${key}`}>
              {label}
              <input id={`admin-account-${key}`} name={key} type="password" autoComplete={autoComplete} required minLength={key === "currentPassword" ? 1 : 10} maxLength={72} className="adm-input mt-1.5" value={pw[key]} onChange={event => { setPw({ ...pw, [key]: event.target.value }); setSaved(false); }} />
            </label>)}
          </fieldset>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-adm-line bg-adm-subtle/60 px-4 py-3">
          {error && <p role="alert" className="text-[13px] text-adm-red">{error}</p>}
          {saved && !error && <p role="status" className="text-[13px] text-adm-green">{main ? C.saved : P.changed}</p>}
          <button type="submit" className="adm-btn adm-btn-primary ml-auto" disabled={busy || !pw.currentPassword || pw.newPassword.length < 10 || !pw.repeat || (main && !email.trim())}>
            {busy ? C.saving : main ? C.save : P.submit}
          </button>
        </div>
      </form>
    </section>
  );
}
