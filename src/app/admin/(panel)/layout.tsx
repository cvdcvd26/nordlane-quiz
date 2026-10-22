import { Suspense } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdmin } from "@/server/admin-auth";

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  return <AdminShell canManageDocuments={admin?.isTemporary === false}>{children}</AdminShell>;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="adm px-8 py-7">
          <div className="adm-skeleton h-64 w-full" aria-busy />
        </div>
      }
    >
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
