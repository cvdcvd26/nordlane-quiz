import type { Metadata, Viewport } from "next";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/onest";
import "./globals.css";
import { content } from "@/config/content";

export const metadata: Metadata = {
  title: content.meta.title,
  description: content.quiz.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#eef2f1",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
