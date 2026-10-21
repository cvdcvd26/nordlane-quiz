import type { Metadata } from "next";
import { MaintenanceScreen } from "@/components/maintenance/MaintenanceScreen";
import { SiteAccessGate } from "@/components/maintenance/SiteAccessGate";

export const metadata: Metadata = {
  title: "Przerwa techniczna — AlleyBiz",
  description: "Serwis AlleyBiz jest chwilowo niedostępny. Wprowadzamy ulepszenia.",
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return <SiteAccessGate initialMaintenance><MaintenanceScreen /></SiteAccessGate>;
}
