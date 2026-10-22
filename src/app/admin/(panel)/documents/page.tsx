import { notFound, redirect } from "next/navigation";
import { getAdmin } from "@/server/admin-auth";
import DocumentGenerator from "@/components/admin/DocumentGenerator";

// This page waits for a fresh owner check before revealing any generator UI.
export const instant = false;

export default async function DocumentsPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.isTemporary !== false) notFound();
  return <DocumentGenerator />;
}
