"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, MessageSquareText, Settings, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { SoundToggle } from "../ui/SoundToggle";
import { ActivityNotifier } from "./ActivityNotifier";
import { LangSwitch, useAdminI18n } from "./i18n";
import { Toaster } from "./toast";
import { BrandMark } from "./BrandMark";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useAdminI18n();
  const [email, setEmail] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
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
    { href: "/admin", label: t.ui.nav.leads, icon: Users, active: path === "/admin" || path.startsWith("/admin/leads") },
    { href: "/admin/reviews", label: t.ui.nav.reviews, icon: MessageSquareText, active: path.startsWith("/admin/reviews") },
    { href: "/admin/settings", label: t.ui.nav.settings, icon: Settings, active: path.startsWith("/admin/settings") },
  ];

  const navLinks = (compact: boolean) =>
    nav.map((n) => (
      <Link
        key={n.href}
        href={n.href}
        aria-current={n.active ? "page" : undefined}
        className={`relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] whitespace-nowrap transition-colors ${
          n.active ? "bg-adm-subtle font-semibold text-adm-ink" : "text-adm-ink-2 hover:bg-adm-subtle/70 hover:text-adm-ink"
        } ${compact ? "" : "w-full"}`}
      >
        {n.active && !compact && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r bg-adm-accent" />}
        <n.icon aria-hidden className={`size-4 ${n.active ? "text-adm-accent" : ""}`} strokeWidth={1.8} />
        {n.label}
      </Link>
    ));

  const tools = (
    <>
      <LangSwitch />
      <SoundToggle appearance="admin" scope="admin" labelOn={t.ui.notify.soundOn} labelOff={t.ui.notify.soundOff} onChange={setSoundOn} />
    </>
  );

  return (
    <div className="adm lg:grid lg:grid-cols-[232px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-adm-line bg-adm-surface px-3 py-4 lg:flex">
        <Link href="/admin" className="flex items-center gap-2.5 px-2.5">
          <BrandMark />
          <span className="text-[14px] leading-tight font-bold whitespace-nowrap">{t.ui.title}</span>
        </Link>
        <nav className="mt-6 flex flex-col gap-0.5" aria-label={t.ui.nav.sections}>
          {navLinks(false)}
        </nav>
        <div className="mt-auto space-y-3 border-t border-adm-line px-1 pt-4">
          <div className="flex items-center gap-2">{tools}</div>
          <p className="truncate text-[12.5px] text-adm-ink-3" title={email ?? ""}>
            {email}
          </p>
          <button type="button" onClick={logout} className="adm-btn adm-btn-quiet -ml-2 h-7 px-2">
            <LogOut aria-hidden className="size-4" strokeWidth={1.8} />
            {t.ui.nav.logout}
          </button>
        </div>
      </aside>

      {/* Top bar (mobile / tablet) */}
      <header className="sticky top-0 z-30 border-b border-adm-line bg-adm-surface lg:hidden">
        <div className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2">
          <Link href="/admin" className="flex items-center gap-2">
            <BrandMark className="size-6" />
            <span className="text-[14px] font-bold whitespace-nowrap">{t.ui.title}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {tools}
            <button type="button" onClick={logout} className="adm-btn size-8 px-0" aria-label={t.ui.nav.logout} title={t.ui.nav.logout}>
              <LogOut aria-hidden className="size-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label={t.ui.nav.sections}>
          {navLinks(true)}
        </nav>
      </header>

      <main className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-[1180px]">
          {email ? (
            children
          ) : (
            <div className="space-y-3" aria-busy aria-label={t.ui.common.loading}>
              <div className="adm-skeleton h-6 w-48" />
              <div className="adm-skeleton h-64 w-full" />
            </div>
          )}
        </div>
      </main>
      {email && <ActivityNotifier soundOn={soundOn} />}
      <Toaster />
    </div>
  );
}
