"use client";
import { reminderCopy } from "@/config/admin-reminders";
import { useAdminI18n } from "./i18n";
import ReminderBoard from "./ReminderBoard";

export default function LeadReminders({ leadId }: { leadId: number }) {
  const { lang } = useAdminI18n();
  const T = reminderCopy[lang];
  return <section id="lead-reminders" className="adm-panel mt-4 scroll-mt-6" aria-labelledby="lead-reminders-title">
    <div className="border-b border-adm-line px-4 py-4">
      <h2 id="lead-reminders-title" className="adm-section-title">{T.title}</h2>
      <p className="adm-help mt-1.5">{T.leadHint}</p>
    </div>
    <ReminderBoard key={leadId} leadId={leadId} />
  </section>;
}
