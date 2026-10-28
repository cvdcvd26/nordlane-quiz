"use client";

import { useState } from "react";
import { ChevronDown, Target } from "lucide-react";
import { useAdminI18n } from "./i18n";
import { useOwnerAdmin } from "./owner-access";
import LeadResultEditor from "./LeadResultEditor";
import { leadResultsCopy } from "@/config/lead-results-copy";

const copy = {
  ru: { title: "Результат по лиду", hint: "Внутренняя оценка и закрытие · только главный администратор" },
  pl: { title: "Wynik leada", hint: "Wewnętrzna ocena i zamknięcie · tylko główny administrator" },
  en: { title: "Lead result", hint: "Internal qualification and closure · main administrator only" },
};

/** Additional administrators do not mount the editor or request any result data. */
export default function OwnerLeadResultPanel({ leadId }: { leadId: string }) {
  const owner = useOwnerAdmin();
  const { lang } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  if (!owner) return null;
  const c = copy[lang];
  const target = `owner-lead-result-${leadId}`;
  return <section className="adm-panel overflow-hidden">
    <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-adm-subtle/50" aria-expanded={open} aria-controls={target} onClick={() => {
      if (open && dirty && !window.confirm(leadResultsCopy[lang].discardWarning)) return;
      setOpen(v => !v);
    }}>
      <Target aria-hidden className="size-4 shrink-0 text-adm-accent" />
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-adm-ink">{c.title}</span><span className="block text-[11px] text-adm-ink-3">{c.hint}</span></span>
      <ChevronDown aria-hidden className={`size-4 shrink-0 text-adm-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    <div id={target} hidden={!open} className="border-t border-adm-line p-4">{open && <LeadResultEditor leadId={leadId} standalone={false} onDirtyChange={setDirty} />}</div>
  </section>;
}
