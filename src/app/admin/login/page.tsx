"use client";
import { useState } from "react";
import Link from "next/link";
import localFont from "next/font/local";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { adminDicts, translateServerMessage } from "@/config/admin-i18n";
import { BrandMark } from "@/components/admin/BrandMark";
import { LoginCodePreview } from "@/components/admin/LoginCodePreview";
import { adminLoginContent } from "@/config/admin-login";
import "./login.css";

const jetbrainsMono = localFont({
  src: [
    { path: "./fonts/JetBrainsMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/JetBrainsMono-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-admin-login",
  display: "swap",
});

export default function AdminLogin() {
  const t = adminDicts.en;
  const L = adminLoginContent;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [invalidCredentials, setInvalidCredentials] = useState(false);
  const router = useRouter();
  const errorText = error ? error instanceof ApiError && error.code === "network"
    ? t.errors.network
    : translateServerMessage(error instanceof Error ? error.message : String(error), "en") : null;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    // Password managers may fill native inputs without firing React's change event.
    const values = new FormData(form);
    const email = String(values.get("email") ?? "");
    const password = String(values.get("password") ?? "");
    if (!email.trim() || !password) {
      setError(new Error(L.missingCredentials));
      (form.elements.namedItem(!email.trim() ? "email" : "password") as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setInvalidCredentials(false);
    try {
      await api("/api/admin/login", { method: "POST", json: { email, password } });
      // Next may preserve the login route in Activity when returning after logout.
      const passwordInput = form.elements.namedItem("password") as HTMLInputElement | null;
      if (passwordInput) passwordInput.value = "";
      setShowPassword(false);
      router.replace("/admin");
    } catch (err) {
      setError(err);
      setInvalidCredentials(err instanceof ApiError && err.status === 401);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={`adm-login ${jetbrainsMono.variable}`} lang="en">
      <div className="adm-login-ambience" aria-hidden="true"><span /><span /></div>
      <header className="adm-login-header">
        <Link href="/" className="adm-login-brand" aria-label="AlleyBiz">
          <BrandMark className="adm-login-brand-mark" />
          <span>AlleyBiz <span className="adm-login-brand-suffix">/admin</span></span>
        </Link>
        <span className="adm-login-header-label">ADMIN / SIGN IN</span>
      </header>

      <div className="adm-login-workspace">
        <section className="adm-login-intro" aria-label={L.eyebrow}>
          <p className="adm-login-eyebrow"><span aria-hidden="true">{"//"}</span> {L.eyebrow}</p>
          <p className="adm-login-headline">{L.intro}<br /><span>{L.introAccent}</span></p>
          <p className="adm-login-description">{L.description}</p>

          <LoginCodePreview comment={L.codeComment} />
        </section>

        <section className="adm-login-panel" aria-labelledby="admin-login-title">
          <div className="adm-login-panel-bar"><span><span aria-hidden="true">&gt;_</span> admin.login</span><LockKeyhole size={15} aria-hidden="true" /></div>
          <form onSubmit={submit} className="adm-login-form" noValidate aria-busy={busy}>
            <p className="adm-login-panel-label">{L.panelLabel}</p>
            <h1 id="admin-login-title">{L.title}</h1>
            <p className="adm-login-subtitle">{L.subtitle}</p>

            <label className="adm-login-label" htmlFor="email">{t.ui.login.email}</label>
            <div className="adm-login-field">
              <Mail size={18} aria-hidden="true" />
              <input id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} required disabled={busy}
                placeholder={L.emailPlaceholder}
                onChange={() => { setError(null); setInvalidCredentials(false); }}
                aria-invalid={invalidCredentials || undefined} aria-describedby={error ? "admin-login-error" : undefined} />
            </div>

            <label className="adm-login-label" htmlFor="password">{t.ui.login.password}</label>
            <div className="adm-login-field">
              <LockKeyhole size={18} aria-hidden="true" />
              <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required disabled={busy}
                placeholder={L.passwordPlaceholder}
                onChange={() => { setError(null); setInvalidCredentials(false); }}
                aria-invalid={invalidCredentials || undefined} aria-describedby={error ? "admin-login-error" : undefined} />
              <button type="button" className="adm-login-password-toggle" onClick={() => setShowPassword((value) => !value)} disabled={busy}
                aria-label={showPassword ? L.hidePassword : L.showPassword} aria-pressed={showPassword} aria-controls="password">
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>

            <p className="adm-login-error" id="admin-login-error" role="alert">{errorText}</p>
            <button type="submit" className="adm-login-submit" disabled={busy}>
              <span aria-live="polite">{busy ? t.ui.login.submitting : t.ui.login.submit}</span><ArrowRight size={18} aria-hidden="true" />
            </button>
            <p className="adm-login-restricted"><LockKeyhole size={13} aria-hidden="true" />{L.restricted}</p>
          </form>
        </section>
      </div>

      <footer className="adm-login-footer">
        <Link href="/"><ArrowLeft size={14} aria-hidden="true" />{L.back}</Link>
        <span aria-hidden="true">[ /admin/login ]</span>
      </footer>
    </main>
  );
}
