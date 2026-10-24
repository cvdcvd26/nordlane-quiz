import { analyticsConfig } from "@/config/analytics";

export type VisitorAttributionInput = {
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null;
  utmContent: string | null; utmTerm: string | null; referrerHost: string | null;
};

/** These are campaign labels only. Click IDs, URL paths and arbitrary query keys are never collected. */
export function collectVisitorAttribution(href: string, referrer: string): VisitorAttributionInput {
  const url = new URL(href);
  const tag = (key: string) => {
    const value = url.searchParams.get(key)?.trim().slice(0, analyticsConfig.maxTagLength).replace(/[\u0000-\u001f\u007f]/g, "");
    return value || null;
  };
  let referrerHost: string | null = null;
  try {
    const source = new URL(referrer);
    if (["http:", "https:"].includes(source.protocol) && source.hostname !== url.hostname) referrerHost = source.hostname;
  } catch { /* Direct visits have no referring URL. */ }
  return {
    utmSource: tag("utm_source"), utmMedium: tag("utm_medium"), utmCampaign: tag("utm_campaign"),
    utmContent: tag("utm_content"), utmTerm: tag("utm_term"), referrerHost,
  };
}
