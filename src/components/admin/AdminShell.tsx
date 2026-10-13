"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { content } from "@/config/content";
import { api, ApiError } from "@/lib/api";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    api<{ admin: { email: string } }>("/api/admin/me")
      .then((r) => setEmail(r.admin.email))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/admin/login");
      });
  }, [router]);

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  };

  const nav = [
    { href: "/admin", label: content.admin.nav.leads, active: path === "/admin" || path.startsWith("/admin/leads") },
    { href: "/admin/settings", label: content.admin.nav.settings, active: path.startsWith("/admin/settings") },
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/admin" className="display text-sm font-bold">
            {content.admin.title}
          </Link>
          <nav className="flex gap-1" aria-label={content.admin.nav.sections}>
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={n.active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm ${n.active ? "bg-paint font-semibold text-on-paint" : "text-slate hover:text-ink"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate">
            <span className="hidden sm:inline">{email}</span>
            <button type="button" onClick={logout} className="underline hover:text-ink">
              {content.admin.nav.logout}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{email ? children : <div className="skeleton h-40 rounded-(--radius-tile)" aria-busy />}</div>
    </div>
  );
}
