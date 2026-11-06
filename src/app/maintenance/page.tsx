import type { Metadata } from "next";
import { MaintenanceScreen } from "@/components/maintenance/MaintenanceScreen";
import { SiteAccessGate } from "@/components/maintenance/SiteAccessGate";
import { brand } from "@/config/brand";

export const metadata: Metadata = {
  title: `Przerwa techniczna — ${brand.name}`,
  description: `Serwis ${brand.name} jest chwilowo niedostępny. Wprowadzamy ulepszenia.`,
  robots: { index: false, follow: false },
};

export default function MaintenancePage() {
  return <SiteAccessGate initialMaintenance><MaintenanceScreen /></SiteAccessGate>;
}
