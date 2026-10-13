import { Suspense } from "react";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8"><div className="skeleton h-40 rounded-(--radius-tile)" aria-busy /></div>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
