import { notFound, redirect } from "next/navigation";
import { getAdmin } from "@/server/admin-auth";
import LeadResultsDashboard from "@/components/admin/LeadResultsDashboard";

// Private metrics never render before a fresh main-administrator check.
export const instant = false;

export default async function LeadResultsPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.isTemporary !== false) notFound();
  return <LeadResultsDashboard />;
}
