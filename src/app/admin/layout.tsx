import type { Metadata } from "next";
import { content } from "@/config/content";

export const metadata: Metadata = {
  title: content.admin.title,
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
