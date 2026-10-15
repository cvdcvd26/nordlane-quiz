"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { LangSwitch, useAdminI18n } from "@/components/admin/i18n";
import { BrandMark } from "@/components/admin/BrandMark";

export default function AdminLogin() {
  const { t, err: tErr } = useAdminI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/login", { method: "POST", json: { email, password } });
      router.replace("/admin");
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
    }
  };

  return (
    <main className="adm relative grid place-items-center px-4 py-10">
      <LangSwitch className="absolute top-4 right-4" />
      <div className="w-full max-w-[360px]">
        <div className="mb-5 flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15px] font-bold">Nordlane</span>
        </div>
        <form onSubmit={submit} className="adm-panel p-6" noValidate>
          <h1 className="text-[18px] font-bold">{t.ui.login.title}</h1>
          <label className="adm-label mt-5" htmlFor="email">
            {t.ui.login.email}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            className="adm-input mt-1.5 h-9"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <label className="adm-label mt-4" htmlFor="password">
            {t.ui.login.password}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="adm-input mt-1.5 h-9"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <p className="mt-3 min-h-5 text-[13px] text-adm-red" role="alert">
            {error}
          </p>
          <button type="submit" className="adm-btn adm-btn-primary mt-1 h-9 w-full" disabled={busy || !email || !password}>
            {busy ? t.ui.login.submitting : t.ui.login.submit}
          </button>
        </form>
      </div>
    </main>
  );
}
