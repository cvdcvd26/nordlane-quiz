/** Explicit public origins; arbitrary Vercel previews are never production hosts. */
export const siteDomains = {
  canonical: "https://itsolution.fun",
  legacy: "https://alleybiz.vercel.app",
  preland: "https://land.itsolution.fun",
} as const;

export const quizOrigins: readonly string[] = [siteDomains.canonical, siteDomains.legacy];

/** Previous production aliases are closed together; arbitrary previews are unaffected. */
export const legacySiteHosts: readonly string[] = [
  "alleybiz.vercel.app",
  "nordlane-quiz.vercel.app",
  "nordlane-quiz-alley9.vercel.app",
  "nordlane-quiz-git-main-alley9.vercel.app",
];

export const legacySiteRetired = () => process.env.LEGACY_SITE_RETIRED === "true";

export const MIGRATION_CHECKED_COOKIE = "nl_domain_checked";
// __Host- prevents another subdomain from injecting a Domain-scoped nonce.
export const MIGRATION_NONCE_COOKIE = "__Host-nl_domain_nonce";

const transferPaths = new Set(["/", "/step-2", "/step-3-task", "/step-4-confirmation", "/cookie-policy"]);
const transferQueryKeys = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"]);

/** Keep only known public destinations and campaign labels; never arbitrary redirects. */
export function migrationDestination(input: string | null): string {
  if (!input?.startsWith("/") || input.startsWith("//") || input.includes("\\")) return "/";
  try {
    const parsed = new URL(input, siteDomains.canonical);
    if (parsed.origin !== siteDomains.canonical || !transferPaths.has(parsed.pathname)) return "/";
    const query = new URLSearchParams();
    for (const [key, value] of parsed.searchParams) {
      if (transferQueryKeys.has(key)) query.set(key, value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, key === "fbclid" ? 512 : 120));
      else if (key === "account" && value === "1") query.set(key, value);
    }
    return `${parsed.pathname}${query.size ? `?${query}` : ""}`;
  } catch { return "/"; }
}

export const isMigrationQuizPath = (pathname: string) => transferPaths.has(pathname);

export function domainMigrationEnabled() {
  // Retirement explicitly forbids redirects and cross-domain session recovery.
  if (legacySiteRetired()) return false;
  try {
    const configured = new URL(process.env.APP_URL ?? "");
    return process.env.SITE_DOMAIN_MIGRATION_ENABLED === "true" && configured.origin === siteDomains.canonical &&
      configured.pathname === "/" && !configured.search && !configured.hash && !configured.username && !configured.password;
  } catch { return false; }
}
