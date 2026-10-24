"use client";
import ReminderBoard from "@/components/admin/ReminderBoard";
import { useAdminI18n } from "@/components/admin/i18n";
import { PageHeader } from "@/components/admin/ui";
import { reminderCopy } from "@/config/admin-reminders";

export default function RemindersPage() {
  const { lang } = useAdminI18n();
  const T = reminderCopy[lang];
  return <div>
    <PageHeader title={T.title} description={T.hint} />
    <section className="adm-panel" aria-label={T.title}><ReminderBoard /></section>
  </div>;
}
