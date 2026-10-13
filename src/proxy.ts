import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for admin pages without a session cookie.
 * Real authorization happens on the server in every /api/admin/* handler (requireAdmin).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();
  if (!req.cookies.has("nl_admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
