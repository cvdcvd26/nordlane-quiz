"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BellRing, ChartNoAxesCombined, FileText, LogOut, MessageSquareText, Settings, Target, Users } from "lucide-react";
import { leadResultsCopy } from "@/config/lead-results-copy";
import { OwnerAdminContext } from "./owner-access";
import { documentAdminContent } from "@/config/document-admin";
import { adminAccountUpdatedEvent } from "@/config/admin-account";
import { reminderCopy } from "@/config/admin-reminders";
import { analyticsCopy } from "@/config/analytics";
import { workflowCopy } from "@/config/admin-workflow";
import { confirmAdminDraftNavigation, hasDirtyAdminDrafts, installAdminDraftLinkGuard } from "@/lib/admin-draft-guard";
import { api, ApiError } from "@/lib/api";
import { SoundToggle } from "../ui/SoundToggle";
import { ActivityNotifier } from "./ActivityNotifier";
import { LangSwitch, useAdminI18n } from "./i18n";
import { Toaster } from "./toast";
import { BrandMark } from "./BrandMark";
import { AdminThemeToggle, useAdminTheme } from "./AdminThemeToggle";

export function AdminShell({ children, canManageDocuments = false }: { children: React.ReactNode; canManageDocuments?: boolean }) {
  const { t, lang } = useAdminI18n();
  const theme = useAdminTheme();
  const [email, setEmail] = useState<string | null>(null);
  const [permanentAdmin, setPermanentAdmin] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const path = usePathname();
  const router = useRouter();
  const draftWarning = workflowCopy[lang].draftWarning;
  useEffect(() => {
    const releaseLinks = installAdminDraftLinkGuard(() => draftWarning);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyAdminDrafts()) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { releaseLinks(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [draftWarning]);

  useEffect(() => {
    let controller: AbortController;
    const loadAccount = () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void api<{ admin: { email: string; isTemporary: boolean } }>("/api/admin/me", { signal })
        .then((r) => {
          if (signal.aborted) return;
          setEmail(r.admin.email);
          setPermanentAdmin(r.admin.isTemporary === false);
        })
        .catch((err) => {
          if (signal.aborted) return;
          if (err instanceof ApiError && err.status === 401) router.replace("/admin/login");
        });
    };
    loadAccount();
    window.addEventListener(adminAccountUpdatedEvent, loadAccount);
    return () => { controller.abort(); window.removeEventListener(adminAccountUpdatedEvent, loadAccount); };
  }, [router]);

  const logout = async () => {
    if (!confirmAdminDraftNavigation(draftWarning)) return;
    await api("/api/admin/logout", { method: "POST" }).catch(() => {});
    setEmail(null);
    setPermanentAdmin(false);
    router.replace("/admin/login");
  };

  const nav = [
    { href: "/admin", label: t.ui.nav.leads, icon: Users, active: path === "/admin" || path.startsWith("/admin/leads") },
    { href: "/admin/reminders", label: reminderCopy[lang].title, icon: BellRing, active: path.startsWith("/admin/reminders") },
    { href: "/admin/analytics", label: analyticsCopy[lang].title, icon: ChartNoAxesCombined, active: path.startsWith("/admin/analytics") },
    ...(canManageDocuments && permanentAdmin ? [{ href: "/admin/results", label: leadResultsCopy[lang].title, icon: Target, active: path.startsWith("/admin/results") }] : []),
    { href: "/admin/reviews", label: t.ui.nav.reviews, icon: MessageSquareText, active: path.startsWith("/admin/reviews") },
    { href: "/admin/settings", label: t.ui.nav.settings, icon: Settings, active: path.startsWith("/admin/settings") },
    ...(canManageDocuments && permanentAdmin ? [{ href: "/admin/documents", label: documentAdminContent[lang].nav, icon: FileText, active: path.startsWith("/admin/documents") }] : []),
  ];

  const navLinks = (compact: boolean) =>
    nav.map((n) => (
      <Link
        key={n.href}
        href={n.href}
        aria-current={n.active ? "page" : undefined}
        className={`relative flex min-h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors ${n.href === "/admin/documents" && !compact ? "py-1.5 leading-snug whitespace-normal" : "h-8 whitespace-nowrap"} ${
          n.active ? "bg-adm-subtle font-semibold text-adm-ink" : "text-adm-ink-2 hover:bg-adm-subtle/70 hover:text-adm-ink"
        } ${compact ? "" : "w-full"}`}
      >
        {n.active && !compact && <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r bg-adm-accent" />}
        <n.icon aria-hidden className={`size-4 shrink-0 ${n.active ? "text-adm-accent" : ""}`} strokeWidth={1.8} />
        {n.label}
      </Link>
    ));

  const tools = (
    <>
      <LangSwitch />
      <AdminThemeToggle />
      <SoundToggle appearance="admin" scope="admin" labelOn={t.ui.notify.soundOn} labelOff={t.ui.notify.soundOff} onChange={setSoundOn} />
    </>
  );

  return (
    <OwnerAdminContext.Provider value={canManageDocuments && permanentAdmin}>
    <div className="adm lg:grid lg:grid-cols-[232px_1fr]" data-admin-theme={theme}>
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
        <div className={`mx-auto ${path.startsWith("/admin/leads/") ? "max-w-[1600px]" : "max-w-[1180px]"}`}>
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
    </OwnerAdminContext.Provider>
  );
}
