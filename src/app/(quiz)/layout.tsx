import { QuizApp } from "@/components/visitor/QuizApp";
import { Suspense } from "react";
import { CookieConsent } from "@/components/privacy/CookieConsent";
import { SiteAccessGate } from "@/components/maintenance/SiteAccessGate";

/** A persistent shell keeps in-memory drafts intact across the four step URLs. */
export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return <SiteAccessGate><QuizApp />{children}<Suspense fallback={null}><CookieConsent /></Suspense></SiteAccessGate>;
}
