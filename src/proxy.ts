import { NextResponse, type NextRequest } from "next/server";
import { isMaintenanceEnabled } from "@/server/maintenance";
import { log } from "@/server/log";

const presentationAssets = new Set([
  "/favicon.ico", "/icon.svg", "/alleybiz-mark.svg",
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
  matcher: ["/admin", "/admin/:path*", "/((?!api(?:/|$)|admin(?:/|$)|_next(?:/|$)|favicon\\.ico$|icon\\.svg$|alleybiz-mark\\.svg$|(?:aneta|maja|hanna|agnieszka)-hr\\.png$).*)"],
};
