export const META_MARKER_PREFIX = "ab_meta_events:";
export const META_MARKER_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/** First-party markers and cookies only; never touches the visitor's access cookie. */
export function clearMetaMarketingStorage() {
  if (typeof window === "undefined") return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(META_MARKER_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* Optional storage may be unavailable. */ }
  const host = window.location.hostname;
  const domains = ["", `; Domain=${host}`, `; Domain=.${host}`];
  // Also remove cookies set on a registrable parent when using a custom subdomain.
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) domains.push(`; Domain=.${parts.slice(i).join(".")}`);
  for (const name of ["_fbp", "_fbc"]) {
    for (const domain of domains) {
      try { document.cookie = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${domain}`; } catch { /* Cookies may be disabled. */ }
    }
  }
}

export function hasMetaStageMarker(scope: string, step: number) {
  try {
    const raw = localStorage.getItem(`${META_MARKER_PREFIX}${scope}:${step}`);
    const at = Number(raw);
    return Boolean(raw) && Number.isFinite(at) && at <= Date.now() && Date.now() - at < META_MARKER_MAX_AGE_MS;
  } catch { return false; }
}

export function saveMetaStageMarker(scope: string, step: number) {
  try { localStorage.setItem(`${META_MARKER_PREFIX}${scope}:${step}`, String(Date.now())); }
  catch { /* In-memory deduplication still protects the current page. */ }
}
