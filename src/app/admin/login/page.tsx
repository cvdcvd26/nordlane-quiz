"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { content } from "@/config/content";
import { api } from "@/lib/api";

export default function AdminLogin() {
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
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm" noValidate>
        <p className="display text-lg font-bold">{content.brand.name}</p>
        <h1 className="mt-8 text-2xl font-semibold">{content.admin.login.title}</h1>
        <label className="mt-6 block text-sm font-medium" htmlFor="email">
          {content.admin.login.email}
        </label>
        <input id="email" type="email" autoComplete="username" required className="field mt-1.5" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          {content.admin.login.password}
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          className="field mt-1.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="mt-3 min-h-5 text-sm text-danger" role="alert">
          {error}
        </p>
        <button type="submit" className="btn btn-primary mt-2 w-full" disabled={busy || !email || !password}>
          {busy ? content.admin.login.submitting : content.admin.login.submit}
        </button>
      </form>
    </main>
  );
}
