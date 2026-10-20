import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/manrope";
import "./globals.css";
import { content } from "@/config/content";
import { CookieConsent } from "@/components/privacy/CookieConsent";

export const metadata: Metadata = {
  title: content.meta.title,
  description: content.quiz.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050807",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>
        {children}
        <Suspense fallback={null}>
          <CookieConsent />
        </Suspense>
      </body>
    </html>
  );
}
