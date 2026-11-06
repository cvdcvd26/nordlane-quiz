import type { Metadata } from "next";
import { brand } from "@/config/brand";

export const metadata: Metadata = { title: `${brand.name} /admin — Sign in` };

export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
