"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Filter, LockKeyhole, RefreshCw, ShieldCheck, Target, Users, X } from "lucide-react";
import type { AnalyticsPeriod } from "@/config/analytics";
import { leadClosures, type LeadResultsReport, type LeadResultsSource } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";
import { api, ApiError } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { ErrorState, PageHeader } from "./ui";
import LeadResultEditor from "./LeadResultEditor";
import "./lead-results.css";

type Query = { period: AnalyticsPeriod; from?: string; to?: string; source: string; responsible: string; page: number };
type SourceOption = LeadResultsSource & { key: string };
const INITIAL_QUERY: Query = { period: "30d", source: "all", responsible: "all", page: 1 };

function PanelHeading({ title, hint, accessory, id }: { title: string; hint?: string; accessory?: ReactNode; id: string }) {
  return <div className="lres-panel-heading"><div className="min-w-0"><h2 id={id} className="text-[14px] font-bold">{title}</h2>{hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-adm-ink-3">{hint}</p> : null}</div>{accessory}</div>;
}

function ResultDialog({ leadId, name, onClose, onSaved }: { leadId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const { lang } = useAdminI18n();
  const copy = leadResultsCopy[lang];
  const ref = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      const trigger = document.querySelector<HTMLElement>(`[data-lead-result-edit="${leadId}"]`);
      const target = previousFocus?.isConnected ? previousFocus : trigger ?? document.querySelector<HTMLElement>(".lres-dashboard");
      target?.focus({ preventScroll: true });
    };
  }, [leadId]);
  const close = () => { if (!dirty || window.confirm(copy.discardWarning)) onClose(); };
  return <dialog ref={ref} className="lres lres-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }}>
    <div className="lres-dialog-header"><div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.12em] text-adm-ink-3">#{leadId}</p><h2 id={`${id}-title`} className="mt-1 truncate text-[17px] font-bold">{name}</h2></div><button className="adm-btn size-8 shrink-0 px-0" type="button" onClick={close} aria-label={copy.close} autoFocus><X aria-hidden className="size-4" /></button></div>
    <div className="p-4 sm:p-6"><LeadResultEditor leadId={leadId} standalone={false} onSaved={onSaved} onDirtyChange={setDirty} /></div>
  </dialog>;
}

export default function LeadResultsDashboard() {
  const { lang, t } = useAdminI18n();
  const copy = leadResultsCopy[lang];
  const id = useId();
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("all");
  const [responsible, setResponsible] = useState("all");
  const [query, setQuery] = useState<Query>(INITIAL_QUERY);
  const [report, setReport] = useState<LeadResultsReport | null>(null);
  const [sourceOptions, setSourceOptions] = useState<SourceOption[]>([]);
  const [admins, setAdmins] = useState<LeadResultsReport["responsibleAdmins"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"range" | "forbidden" | "load" | null>(null);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let redirected = false;
    const params = new URLSearchParams({ period: query.period, source: query.source, responsible: query.responsible, page: String(query.page) });
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    void api<LeadResultsReport>(`/api/admin/lead-results?${params}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, data.leads.pages);
        if (data.leads.page > lastPage) {
          redirected = true;
          setQuery(current => ({ ...current, page: lastPage }));
          return;
        }
        setReport(data);
        setAdmins(data.responsibleAdmins);
        setSourceOptions(data.sourceOptions);
        setError(null);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        const forbidden = reason instanceof ApiError && [401, 403].includes(reason.status);
        if (forbidden) { setAdmins([]); setSourceOptions([]); setEditor(null); }
        setError(forbidden ? "forbidden" : reason instanceof ApiError && reason.code === "analytics_range" ? "range" : "load");
      })
      .finally(() => { if (!controller.signal.aborted && !redirected) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);

  const number = (value: number) => new Intl.NumberFormat(t.locale).format(value);
  const rate = (value: number | null) => value === null ? "—" : `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(value * 100)}%`;
  const percent = (value: number, total: number) => rate(total ? value / total : null);
  const sourceName = (row: LeadResultsSource) => row.kind === "unknown" ? copy.unknown : row.kind === "direct" ? copy.direct : row.kind === "other" ? copy.other : row.source ?? copy.untagged;
  const sourceOptionName = (row: LeadResultsSource) => [sourceName(row), row.medium, row.campaign].filter(Boolean).join(" · ");
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, { day: "numeric", month: "short", timeZone: "Europe/Warsaw" });
  const runQuery = (next: Query) => { setLoading(true); setError(null); setReport(null); setQuery(next); setReload(value => value + 1); };
  const refresh = () => runQuery(query);
  const total = report?.totals.leads ?? 0;
  const lost = report ? report.closures.not_suitable + report.closures.candidate_declined + report.closures.no_contact : 0;
  const trendMax = report ? Math.max(1, ...report.daily.map(day => day.leads)) : 1;
  const trendTicks = trendMax > 1 ? [0, Math.ceil(trendMax / 2), trendMax] : [0, 1];
  const chartWidth = Math.max(540, (report?.daily.length ?? 0) * 9);
  const chartHeight = 146;
  const labelEvery = Math.max(1, Math.ceil((report?.daily.length ?? 0) / 7));

  return <div className="lres lres-dashboard" tabIndex={-1}>
    <PageHeader title={copy.title} description={copy.description} meta={<span className="lres-private"><LockKeyhole aria-hidden className="size-3" />{copy.ownerOnly}</span>} actions={<button type="button" className="adm-btn adm-btn-sm" disabled={loading} onClick={refresh}><RefreshCw aria-hidden className={`size-3.5 ${loading ? "animate-spin" : ""}`} />{copy.refresh}</button>} />
    <form className="adm-panel lres-filter-panel" onSubmit={event => {
      event.preventDefault();
      runQuery({ period, ...(period === "custom" ? { from, to } : {}), source, responsible, page: 1 });
    }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[12px] font-bold text-adm-ink-2"><Filter aria-hidden className="size-3.5" />{copy.period}</div><div className="lres-periods" role="group" aria-label={copy.period}>{(Object.keys(copy.periods) as AnalyticsPeriod[]).map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); if (value === "custom" && report) { setFrom(report.range.from); setTo(report.range.to); } }}>{copy.periods[value]}</button>)}</div></div>
      <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
        {period === "custom" ? <div className="grid grid-cols-2 gap-3 sm:col-span-2 xl:col-span-3">
          <label className="lres-label" htmlFor={`${id}-from`}>{copy.from}<input id={`${id}-from`} className="adm-input" type="date" required min="2000-01-01" max="2100-12-31" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="lres-label" htmlFor={`${id}-to`}>{copy.to}<input id={`${id}-to`} className="adm-input" type="date" required min={from || "2000-01-01"} max="2100-12-31" value={to} onChange={event => setTo(event.target.value)} /></label>
        </div> : null}
        <label className="lres-label min-w-0" htmlFor={`${id}-source`}>{copy.source}<select id={`${id}-source`} className="adm-input min-w-0" value={source} onChange={event => setSource(event.target.value)}><option value="all">{copy.allSources}</option>{source !== "all" && !sourceOptions.some(row => row.key === source) ? <option value={source}>{copy.selectedSource}</option> : null}{sourceOptions.map(row => <option key={row.key} value={row.key}>{sourceOptionName(row)}</option>)}</select></label>
        <label className="lres-label min-w-0" htmlFor={`${id}-responsible`}>{copy.responsible}<select id={`${id}-responsible`} className="adm-input min-w-0" value={responsible} onChange={event => setResponsible(event.target.value)}><option value="all">{copy.allAccounts}</option><option value="unassigned">{copy.unassigned}</option>{admins.map(admin => <option key={admin.id} value={admin.id}>{admin.email}</option>)}</select></label>
        <button type="submit" className="adm-btn adm-btn-primary sm:col-span-2 xl:col-span-1" disabled={loading}>{copy.apply}<ArrowUpRight aria-hidden className="size-3.5" /></button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-adm-ink-3">{copy.dateHint}</p>
    </form>
    {error ? <div className="mt-4"><ErrorState text={error === "forbidden" ? copy.forbidden : error === "range" ? copy.rangeError : copy.failed} onRetry={error === "forbidden" ? undefined : refresh} /></div> : null}
    {loading ? <div className="mt-5 space-y-4" role="status" aria-label={copy.loading}><div className="grid gap-4 lg:grid-cols-[5fr_7fr]"><div className="adm-skeleton h-64" /><div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map(key => <div key={key} className="adm-skeleton h-30" />)}</div></div><div className="adm-skeleton h-72" /><span className="sr-only">{copy.loading}</span></div> : null}
    {report ? <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11.5px] text-adm-ink-3"><p className="font-semibold tabular-nums">{dateLabel(report.range.from)} — {dateLabel(report.range.to)} <span className="ml-1 font-normal">{report.range.from.slice(0, 4) !== report.range.to.slice(0, 4) ? `${report.range.from.slice(0, 4)} / ${report.range.to.slice(0, 4)}` : report.range.to.slice(0, 4)} · Europe/Warsaw</span></p><p>{copy.updated} <time dateTime={report.generatedAt}>{new Date(report.generatedAt).toLocaleString(t.locale, { timeZone: "Europe/Warsaw", hourCycle: "h23", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></p></div>
      <div className="grid gap-4 lg:grid-cols-[5fr_7fr]">
        <section className="lres-success" aria-labelledby={`${id}-success`}>
          <div className="flex items-start justify-between gap-4"><span className="lres-hero-icon"><CheckCircle2 aria-hidden className="size-5" /></span><span className="lres-hero-check"><Check aria-hidden className="size-3" />{copy.successLegend}</span></div>
          <h2 id={`${id}-success`} className="mt-4 max-w-80 text-[17px] leading-snug font-bold">{copy.success}</h2>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3"><p className="lres-hero-number">{number(report.totals.success)}</p><div className="pb-1 text-right"><p className="text-[25px] leading-tight font-bold tabular-nums">{rate(report.rates.successOfAll)}</p><p className="mt-1 text-[10.5px] opacity-80">{copy.successRate}</p><p className="mt-1 text-[11px] tabular-nums opacity-85">{number(report.totals.success)} / {number(total)}</p></div></div>
          <div className="lres-hero-track mt-4" aria-hidden><span style={{ width: `${(report.rates.successOfAll ?? 0) * 100}%` }} /></div>
          <p className="mt-2.5 text-[11px] leading-relaxed opacity-80">{copy.successHint}</p>
        </section>
        <dl className="grid grid-cols-2 gap-3">
          {[
            { label: copy.allLeads, count: total, icon: Users, tone: "neutral", hint: copy.allHint },
            { label: copy.reviewed, count: report.totals.reviewed, icon: ClipboardCheck, tone: "blue", hint: `${percent(report.totals.reviewed, total)} · ${copy.reviewedHint}` },
            { label: copy.suitable, count: report.totals.suitable, icon: Target, tone: "green", hint: `${rate(report.rates.suitableOfReviewed)} · ${copy.suitableRate}` },
            { label: copy.unreviewed, count: report.totals.unreviewed, icon: Clock3, tone: "amber", hint: `${percent(report.totals.unreviewed, total)} · ${copy.allLeads.toLocaleLowerCase(t.locale)}` },
          ].map(metric => <div key={metric.label} className="adm-panel lres-metric"><div className="flex items-center justify-between gap-2"><dt className="text-[11px] font-semibold text-adm-ink-2 sm:text-[12px]">{metric.label}</dt><span className={`lres-metric-icon lres-tone-${metric.tone}`}><metric.icon aria-hidden className="size-3.5" /></span></div><dd className="mt-2 text-[29px] leading-none font-bold tracking-tight tabular-nums">{number(metric.count)}</dd><dd className="mt-2 text-[10.5px] leading-relaxed text-adm-ink-3">{metric.hint}</dd></div>)}
        </dl>
      </div>
      <p className="lres-cohort"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-adm-accent" /><span>{copy.cohortHint}</span></p>
      {total === 0 ? <div className="adm-panel lres-empty"><span className="lres-empty-icon"><ArrowDownToLine aria-hidden className="size-6" /></span><h2 className="mt-4 text-[17px] font-bold">{copy.empty}</h2><p className="mt-2 max-w-md text-[13px] leading-relaxed text-adm-ink-3">{copy.emptyHint}</p></div> : <>
        <div className="grid gap-4 xl:grid-cols-[5fr_7fr]">
          <section className="adm-panel overflow-hidden" aria-labelledby={`${id}-outcomes`}><PanelHeading id={`${id}-outcomes`} title={copy.outcomes} hint={copy.outcomesHint} />
            <div className="lres-outcomes"><div className="lres-donut"><svg viewBox="0 0 172 172" aria-hidden><circle cx="86" cy="86" r="66" fill="none" stroke="var(--color-adm-line)" strokeWidth="17" />{leadClosures.map((closure, index) => {
              const value = report.closures[closure] / total * 100;
              const offset = leadClosures.slice(0, index).reduce((sum, key) => sum + report.closures[key], 0) / total * 100;
              return value > 0 ? <circle key={closure} className={`lres-stroke-${closure}`} cx="86" cy="86" r="66" fill="none" strokeWidth="17" pathLength="100" strokeDasharray={`${value} ${100 - value}`} strokeDashoffset={-offset} transform="rotate(-90 86 86)" /> : null;
            })}</svg><div><strong>{number(total)}</strong><span>{copy.leads}</span></div></div><ul className="min-w-0 flex-1 space-y-3">{leadClosures.map(closure => <li key={closure} className="lres-outcome-row"><span className={`lres-dot lres-fill-${closure}`} aria-hidden /><span className="min-w-0 flex-1 text-[11.5px] leading-snug text-adm-ink-2">{copy.closures[closure]}</span><span className="text-[12px] font-bold tabular-nums">{number(report.closures[closure])}</span><span className="w-11 text-right text-[10.5px] text-adm-ink-3 tabular-nums">{percent(report.closures[closure], total)}</span></li>)}</ul></div>
          </section>
          <section className="adm-panel min-w-0 overflow-hidden" aria-labelledby={`${id}-trend`}><PanelHeading id={`${id}-trend`} title={copy.trend} hint={copy.trendHint} />
            <div className="flex items-center gap-4 px-4 pt-4 text-[10.5px] text-adm-ink-2"><span className="flex items-center gap-1.5"><span className="lres-dot bg-adm-line-strong" aria-hidden />{copy.leadsLegend}</span><span className="flex items-center gap-1.5"><span className="lres-dot lres-fill-signal_working" aria-hidden />{copy.successLegend}</span></div>
            <div className="lres-trend-scroll" tabIndex={0} role="region" aria-label={copy.trend}>
              <svg className="lres-trend" viewBox={`0 0 ${chartWidth} 190`} style={{ minWidth: chartWidth }} role="img" aria-labelledby={`${id}-trend-title`}><title id={`${id}-trend-title`}>{copy.trend}. {copy.leadsLegend}: {number(total)}. {copy.successLegend}: {number(report.totals.success)}.</title>
                {trendTicks.map(tick => <g key={tick}><line x1="30" y1={chartHeight - tick / trendMax * 118} x2={chartWidth - 5} y2={chartHeight - tick / trendMax * 118} stroke="var(--color-adm-line)" strokeDasharray={tick ? "3 4" : undefined} /><text x="23" y={chartHeight - tick / trendMax * 118 + 3} textAnchor="end" className="lres-chart-label">{number(tick)}</text></g>)}
                {report.daily.map((day, index) => {
                  const step = (chartWidth - 40) / report.daily.length;
                  const width = Math.max(2, Math.min(14, step * 0.6));
                  const x = 32 + index * step + (step - width) / 2;
                  return <g key={day.date}><title>{dateLabel(day.date)} · {copy.leadsLegend}: {number(day.leads)} · {copy.successLegend}: {number(day.success)}</title><rect x={x} y={chartHeight - day.leads / trendMax * 118} width={width} height={day.leads / trendMax * 118} rx="2" fill="var(--color-adm-line-strong)" /><rect x={x} y={chartHeight - day.success / trendMax * 118} width={width} height={day.success / trendMax * 118} rx="2" className="lres-fill-signal_working" />{index % labelEvery === 0 || index === report.daily.length - 1 ? <text x={x + width / 2} y="168" textAnchor={index === report.daily.length - 1 ? "end" : index === 0 ? "start" : "middle"} className="lres-chart-label">{dateLabel(day.date)}</text> : null}</g>;
                })}
              </svg>
            </div>
            <details className="lres-daily-data"><summary>{copy.dailyData}<ChevronDown aria-hidden className="size-3" /></summary><div className="max-h-60 overflow-auto" tabIndex={0} role="region" aria-label={copy.dailyData}><table className="adm-table lres-table"><thead><tr><th scope="col">{copy.date}</th><th scope="col">{copy.leadsLegend}</th><th scope="col">{copy.successLegend}</th></tr></thead><tbody>{report.daily.map(day => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{day.date}</time></th><td>{number(day.leads)}</td><td>{number(day.success)}</td></tr>)}</tbody></table></div></details>
          </section>
        </div>
        <section className="adm-panel overflow-hidden" aria-labelledby={`${id}-sources`}><PanelHeading id={`${id}-sources`} title={copy.sources} hint={copy.sourceHint} />
          <div className="overflow-x-auto"><table className="adm-table lres-table"><thead><tr>{[copy.source, copy.medium, copy.campaign, copy.leads, copy.reviewed, copy.suitable, copy.successLegend, copy.conversion].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{report.sources.map((row, index) => <tr key={row.key ?? `other-${index}`}><th scope="row" className="min-w-36 max-w-52 break-words">{sourceName(row)}</th><td className="max-w-36 break-words text-adm-ink-3">{row.medium ?? "—"}</td><td className="max-w-44 break-words text-adm-ink-3">{row.campaign ?? "—"}</td><td>{number(row.leads)}</td><td>{number(row.reviewed)}</td><td>{number(row.suitable)}</td><td className="font-bold text-adm-green">{number(row.success)}</td><td><span className="lres-conversion">{percent(row.success, row.leads)}</span></td></tr>)}</tbody></table></div>
        </section>
        <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
          <section className="adm-panel min-w-0 overflow-hidden" aria-labelledby={`${id}-accounts`}><PanelHeading id={`${id}-accounts`} title={copy.accountBreakdown} hint={copy.accountHint} /><div className="overflow-x-auto"><table className="adm-table lres-table"><thead><tr>{[copy.responsible, copy.leads, copy.reviewed, copy.suitable, copy.successLegend, copy.conversion].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{report.responsibles.map((row, index) => <tr key={row.admin?.id ?? `${row.kind}-${index}`}><th scope="row" className="max-w-56 break-all">{row.kind === "unassigned" ? copy.unassigned : row.kind === "other" ? copy.other : row.admin?.email ?? copy.unknownAccount}</th><td>{number(row.leads)}</td><td>{number(row.reviewed)}</td><td>{number(row.suitable)}</td><td className="font-bold text-adm-green">{number(row.success)}</td><td>{percent(row.success, row.leads)}</td></tr>)}</tbody></table></div></section>
          <section className="adm-panel overflow-hidden" aria-labelledby={`${id}-reasons`}><PanelHeading id={`${id}-reasons`} title={copy.reasons} hint={copy.reasonsHint} accessory={<span className="lres-loss-total">{number(lost)}</span>} />{lost === 0 ? <p className="p-5 text-[12px] text-adm-ink-3">{copy.noLosses}</p> : <ul className="space-y-3 p-4">{report.lossReasons.map(row => <li key={row.reason ?? "none"}><div className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px]"><span className="text-adm-ink-2">{row.reason ? copy.reasonLabels[row.reason] : copy.noReason}</span><span className="font-bold tabular-nums">{number(row.leads)} <span className="ml-2 text-[10.5px] font-normal text-adm-ink-3">{percent(row.leads, lost)}</span></span></div><div className="lres-loss-track" aria-hidden><span style={{ width: `${row.leads / lost * 100}%` }} /></div></li>)}</ul>}</section>
        </div>
        <section className="adm-panel overflow-hidden" aria-labelledby={`${id}-list`}><PanelHeading id={`${id}-list`} title={copy.list} accessory={<span className="text-[12px] font-semibold text-adm-ink-3 tabular-nums">{number(report.leads.total)}</span>} />
          <div className="overflow-x-auto"><table className="adm-table lres-table lres-lead-table"><thead><tr>{[copy.candidate, copy.qualification, copy.closure, copy.responsible, copy.source, copy.created].map(label => <th key={label} scope="col">{label}</th>)}<th scope="col"><span className="sr-only">{copy.edit}</span></th></tr></thead><tbody>{report.leads.items.map(lead => <tr key={lead.id}>
            <th scope="row" className="min-w-40"><Link href={`/admin/leads/${lead.id}`} className="lres-lead-link" title={copy.viewLead}>{lead.name || copy.unnamed}<ArrowUpRight aria-hidden className="size-3 shrink-0" /></Link><p className="mt-1 text-[10.5px] font-normal text-adm-ink-3">#{lead.id}{lead.phone ? ` · ${lead.phone}` : ""}</p></th>
            <td><span className={`lres-badge lres-q-${lead.result.qualification}`}>{copy.qualifications[lead.result.qualification]}</span></td><td className="min-w-40 max-w-60"><span className={`lres-badge lres-c-${lead.result.closure}`}><span className="lres-dot bg-current" aria-hidden />{copy.closures[lead.result.closure]}</span></td><td className="max-w-44 break-all text-adm-ink-2">{lead.responsible?.email ?? copy.unassigned}</td><td className="max-w-40 break-words text-adm-ink-3">{sourceName(lead.source)}{lead.source.campaign ? <p className="mt-1 text-[10.5px]">{lead.source.campaign}</p> : null}</td><td className="whitespace-nowrap text-adm-ink-3"><time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" })}</time></td><td><button type="button" className="adm-btn adm-btn-sm" data-lead-result-edit={lead.id} onClick={() => setEditor({ id: String(lead.id), name: lead.name || copy.unnamed })} aria-label={`${copy.edit}: ${lead.name || `#${lead.id}`}`}>{copy.edit}</button></td>
          </tr>)}</tbody></table></div>
          <div className="lres-pagination"><span className="text-[11.5px] text-adm-ink-3 tabular-nums">{copy.page} {report.leads.page} {copy.of} {Math.max(1, report.leads.pages)} · {number(report.leads.total)} {copy.leads.toLocaleLowerCase(t.locale)}</span><div className="flex gap-2"><button type="button" className="adm-btn adm-btn-sm" disabled={loading || report.leads.page <= 1} onClick={() => runQuery({ ...query, page: report.leads.page - 1 })}><ChevronLeft aria-hidden className="size-3.5" />{copy.previous}</button><button type="button" className="adm-btn adm-btn-sm" disabled={loading || report.leads.page >= report.leads.pages} onClick={() => runQuery({ ...query, page: report.leads.page + 1 })}>{copy.next}<ChevronRight aria-hidden className="size-3.5" /></button></div></div>
        </section>
      </>}
      <p className="lres-internal-hint flex items-start gap-2"><LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{copy.internalHint}</span></p>
    </div> : null}
    {editor ? <ResultDialog leadId={editor.id} name={editor.name} onClose={() => setEditor(null)} onSaved={refresh} /> : null}
  </div>;
}
