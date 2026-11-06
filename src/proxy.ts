import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceEnabled } from "@/server/maintenance";
import { log } from "@/server/log";
import { domainMigrationEnabled, isMigrationQuizPath, legacySiteHosts, legacySiteRetired, migrationDestination, MIGRATION_CHECKED_COOKIE, siteDomains } from "@/config/site-domains";

const presentationAssets = new Set([
  "/favicon.ico", "/icon.svg", "/alleybiz-mark.svg", "/it-solution-mark.svg",
  "/aneta-hr.png", "/maja-hr.png", "/hanna-hr.png", "/agnieszka-hr.png",
]);

/** APIs enforce their own gate; the admin panel and its presentation assets stay reachable. */
export function bypassMaintenanceProxy(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/") ||
    pathname === "/api" || pathname.startsWith("/api/") ||
    pathname === "/_next" || pathname.startsWith("/_next/") ||
    presentationAssets.has(pathname);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Close the host itself, including APIs, admin, files and old recovery routes.
  // This must precede every maintenance, static-asset and bridge bypass.
  if (legacySiteRetired() && legacySiteHosts.includes(request.nextUrl.hostname)) {
    return new NextResponse("Ta strona została zamknięta.", {
      status: 410,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      },
    });
  }
  // The bridge is an isolated route handler; it must not run the app layout or
  // enter maintenance/redirect loops. Authentication happens in its handlers.
  if (pathname.startsWith("/session-transfer/")) return NextResponse.next();
  if (domainMigrationEnabled()) {
    const oldHost = request.nextUrl.origin === siteDomains.legacy;
    const newHost = request.nextUrl.origin === siteDomains.canonical;
    const adminPage = pathname === "/admin" || pathname.startsWith("/admin/");
    if (oldHost && adminPage) {
      return NextResponse.redirect(`${siteDomains.canonical}/admin/login`, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
    // Public task material carries no session. Existing open tabs and copied
    // instruction links must receive the PDF, not the HTML recovery bridge.
    if (oldHost && pathname === "/Rejestracja_Ryanair_Instrukcja.pdf") {
      return NextResponse.redirect(`${siteDomains.canonical}${pathname}`, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
    if ((oldHost && !bypassMaintenanceProxy(pathname)) ||
        (newHost && isMigrationQuizPath(pathname) && request.cookies.get(MIGRATION_CHECKED_COOKIE)?.value !== "1")) {
      const target = new URL("/session-transfer/start", siteDomains.canonical);
      target.searchParams.set("path", migrationDestination(`${pathname}${request.nextUrl.search}`));
      return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // Preserve the existing fast login redirect; server handlers still verify the session.
    if (pathname !== "/admin/login" && !request.cookies.has("nl_admin")) {
      const login = request.nextUrl.clone();
      login.pathname = "/admin/login";
      login.search = "";
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }
  if (bypassMaintenanceProxy(pathname)) return NextResponse.next();

  let enabled: boolean;
  try {
    // One authoritative flag read, never a cookie, query-string override, or a cached process global.
    enabled = await isMaintenanceEnabled();
  } catch {
    log.error("maintenance.proxy", "availability check failed");
    enabled = true;
  }

  if (!enabled) {
    if (pathname === "/maintenance") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  const destination = request.nextUrl.clone();
  destination.pathname = "/maintenance";
  destination.search = "";
  const responseOptions = {
    status: 503,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": "60",
      "X-Robots-Tag": "noindex, nofollow",
    },
  };
  // The rewritten destination can pass through Proxy again; never rewrite it to itself.
  if (pathname === "/maintenance") return NextResponse.next(responseOptions);
  return NextResponse.rewrite(destination, responseOptions);
}

export const config = {
  matcher: [
    // Static constants are required by Next's build-time matcher analysis.
    { source: "/:path*", has: [{ type: "host", value: "(?:alleybiz|nordlane-quiz|nordlane-quiz-alley9|nordlane-quiz-git-main-alley9)\\.vercel\\.app" }] },
    "/admin", "/admin/:path*", "/((?!api(?:/|$)|admin(?:/|$)|_next(?:/|$)|favicon\\.ico$|icon\\.svg$|(?:alleybiz|it-solution)-mark\\.svg$|(?:aneta|maja|hanna|agnieszka)-hr\\.png$).*)",
  ],
};
