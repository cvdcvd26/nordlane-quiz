"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronLeft, ChevronRight, PartyPopper, RefreshCw, X } from "lucide-react";
import type { LeadResultsSource, LeadResultsSuccessList } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";
import { api, ApiError } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { ErrorState } from "./ui";

export type LeadSuccessSelection = {
  from: string;
  to: string;
  source: string;
  responsible: string;
  sourceLabel: string | null;
  responsibleLabel: string | null;
};

export default function LeadSuccessDialog({ selection, onClose }: { selection: LeadSuccessSelection; onClose: () => void }) {
  const { lang, t } = useAdminI18n();
  const copy = leadResultsCopy[lang];
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<LeadResultsSuccessList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"load" | "forbidden" | null>(null);
  const numbers = useMemo(() => new Intl.NumberFormat(t.locale), [t.locale]);
  const dates = useMemo(() => new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }), [t.locale]);
  const timestamps = useMemo(() => new Intl.DateTimeFormat(t.locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Warsaw" }), [t.locale]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      const target = previousFocus?.isConnected ? previousFocus : document.querySelector<HTMLElement>("[data-lead-success-open]") ?? document.querySelector<HTMLElement>(".lres-dashboard");
      target?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let redirected = false;
    const params = new URLSearchParams({ period: "custom", from: selection.from, to: selection.to, source: selection.source, responsible: selection.responsible, page: String(page) });
    void api<LeadResultsSuccessList>(`/api/admin/lead-results/successes?${params}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, data.leads.pages);
        if (data.leads.page > lastPage) {
          redirected = true;
          setPage(lastPage);
          return;
        }
        setResult(data);
        setError(null);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(reason instanceof ApiError && [401, 403].includes(reason.status) ? "forbidden" : "load");
      })
      .finally(() => { if (!controller.signal.aborted && !redirected) setLoading(false); });
    return () => controller.abort();
  }, [selection.from, selection.to, selection.source, selection.responsible, page, retry]);

  const requestPage = (next: number) => {
    setLoading(true);
    setResult(null);
    setError(null);
    setPage(next);
    setRetry(current => current + 1);
  };
  const sourceName = (source: LeadResultsSource) => source.kind === "unknown" ? copy.unknown : source.kind === "direct" ? copy.direct : source.kind === "other" ? copy.other : source.source ?? copy.untagged;
  const periodDate = (value: string) => dates.format(new Date(`${value}T12:00:00Z`));

  return <dialog ref={dialogRef} className="lres lres-dialog lres-success-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="lres-dialog-header lres-success-dialog-header">
      <div className="lres-success-dialog-title"><span><PartyPopper aria-hidden className="size-5" /></span><div><p>{copy.successesTitle}</p><h2 id={`${id}-title`}>{copy.success}</h2></div></div>
      <button className="adm-btn size-8 shrink-0 px-0" type="button" onClick={onClose} aria-label={copy.close} autoFocus><X aria-hidden className="size-4" /></button>
    </div>
    <div className="lres-success-dialog-context">
      <p>{periodDate(selection.from)} — {periodDate(selection.to)}<span>Europe/Warsaw</span></p>
      <span className="lres-success-dialog-count"><Check aria-hidden className="size-3.5" /><strong>{result ? numbers.format(result.leads.total) : "—"}</strong>{copy.leads}</span>
      {selection.source !== "all" || selection.responsible !== "all" ? <div className="lres-success-filter-chips">{selection.source !== "all" ? <span>{copy.source}: {selection.sourceLabel ?? copy.selectedSource}</span> : null}{selection.responsible !== "all" ? <span>{copy.responsible}: {selection.responsibleLabel ?? copy.unknownAccount}</span> : null}</div> : null}
      <p className="lres-success-dialog-hint" id={`${id}-hint`}>{copy.successesHint}</p>
    </div>
    <div className="lres-success-dialog-body" aria-busy={loading}>
      {loading ? <div className="lres-success-list-loading" role="status" aria-label={copy.loading}>{[0, 1, 2].map(index => <div key={index} className="adm-skeleton h-24" />)}<span className="sr-only">{copy.loading}</span></div> : null}
      {error ? <ErrorState text={error === "forbidden" ? copy.forbidden : copy.successesFailed} onRetry={error === "forbidden" ? undefined : () => requestPage(page)} /> : null}
      {result && result.leads.total === 0 ? <div className="lres-success-list-empty"><PartyPopper aria-hidden className="size-7" /><p>{copy.successesEmpty}</p></div> : null}
      {result && result.leads.total > 0 ? <ul className="lres-success-list">{result.leads.items.map(lead => <li key={lead.id}>
        <div className="lres-success-row-candidate"><span className="lres-success-row-icon" aria-hidden><Check className="size-4" /></span><div><h3>{lead.name || copy.unnamed}</h3><p><span>#{lead.id}</span><span><span className="sr-only">{copy.phone}: </span>{lead.phone ?? "—"}</span></p></div></div>
        <div className="lres-success-row-source"><span className="lres-success-row-label">{copy.source}</span><strong>{sourceName(lead.source)}</strong>{lead.source.campaign || lead.source.medium ? <small>{[lead.source.medium, lead.source.campaign].filter(Boolean).join(" · ")}</small> : null}</div>
        <div className="lres-success-row-date"><span className="lres-success-row-label">{copy.closedAt}</span>{lead.result.closedAt ? <time dateTime={lead.result.closedAt}>{timestamps.format(new Date(lead.result.closedAt))}</time> : <span>—</span>}</div>
        <a className="adm-btn adm-btn-sm lres-success-row-open" href={`/admin/leads/${lead.id}`} target="_blank" rel="noopener noreferrer" aria-label={`${copy.viewLead}: ${lead.name || `#${lead.id}`} — ${copy.openNewTab}`} title={copy.openNewTab}><span>{copy.viewLead}</span><ArrowUpRight aria-hidden className="size-3.5" /></a>
      </li>)}</ul> : null}
    </div>
    {result ? <div className="lres-pagination lres-success-dialog-pagination"><p><span>{copy.page} {result.leads.page} {copy.of} {Math.max(1, result.leads.pages)}</span><span>{copy.updated} {timestamps.format(new Date(result.generatedAt))}</span></p><div className="flex gap-2"><button className="adm-btn adm-btn-sm" type="button" disabled={loading || result.leads.page <= 1} onClick={() => requestPage(result.leads.page - 1)}><ChevronLeft aria-hidden className="size-3.5" />{copy.previous}</button><button className="adm-btn adm-btn-sm" type="button" disabled={loading || result.leads.page >= result.leads.pages} onClick={() => requestPage(result.leads.page + 1)}>{copy.next}<ChevronRight aria-hidden className="size-3.5" /></button></div></div> : null}
    <button className="adm-btn adm-btn-quiet lres-success-dialog-refresh" type="button" disabled={loading || error === "forbidden"} onClick={() => requestPage(page)}><RefreshCw aria-hidden className={`size-3 ${loading ? "animate-spin" : ""}`} />{copy.refresh}</button>
  </dialog>;
}
