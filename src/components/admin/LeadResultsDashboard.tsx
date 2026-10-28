"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Filter, Globe2, LockKeyhole, PartyPopper, RefreshCw, ShieldCheck, Sparkles, Target, Users, X } from "lucide-react";
import type { AnalyticsPeriod } from "@/config/analytics";
import { type LeadResultsReport, type LeadResultsSource } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";
import { api, ApiError } from "@/lib/api";
import { useAdminI18n } from "./i18n";
import { ErrorState, PageHeader } from "./ui";
import LeadResultEditor from "./LeadResultEditor";
import { DailyResultChart, LeadOutcomeDonut } from "./LeadResultsCharts";
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

  const numberFormat = useMemo(() => new Intl.NumberFormat(t.locale), [t.locale]);
  const rateFormat = useMemo(() => new Intl.NumberFormat(t.locale, { style: "percent", maximumFractionDigits: 1 }), [t.locale]);
  const number = (value: number) => numberFormat.format(value);
  const rate = (value: number | null) => value === null ? "—" : rateFormat.format(value);
  const percent = (value: number, total: number) => rate(total ? value / total : null);
  const sourceName = (row: LeadResultsSource) => row.kind === "unknown" ? copy.unknown : row.kind === "direct" ? copy.direct : row.kind === "other" ? copy.other : row.source ?? copy.untagged;
  const sourceOptionName = (row: LeadResultsSource) => [sourceName(row), row.medium, row.campaign].filter(Boolean).join(" · ");
  const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(t.locale, { day: "numeric", month: "short", timeZone: "Europe/Warsaw" });
  const runQuery = (next: Query) => { setLoading(true); setError(null); setReport(null); setQuery(next); setReload(value => value + 1); };
  const refresh = () => runQuery(query);
  const total = report?.totals.leads ?? 0;
  const lost = report ? report.closures.not_suitable + report.closures.candidate_declined + report.closures.no_contact : 0;

  return <div className="lres lres-dashboard" tabIndex={-1}>
    <PageHeader title={copy.title} description={copy.description} meta={<span className="lres-private"><LockKeyhole aria-hidden className="size-3" />{copy.ownerOnly}</span>} actions={
      <button type="button" className="adm-btn lres-refresh" disabled={loading} onClick={refresh}>
        <RefreshCw aria-hidden className={`size-3.5 ${loading ? "animate-spin" : ""}`} />{copy.refresh}
      </button>
    } />
    <form className="adm-panel lres-filter-panel" onSubmit={event => {
      event.preventDefault();
      runQuery({ period, ...(period === "custom" ? { from, to } : {}), source, responsible, page: 1 });
    }}>
      <div className="lres-filter-top">
        <div className="lres-filter-title"><Filter aria-hidden className="size-4" />{copy.period}</div>
        <div className="lres-periods" role="group" aria-label={copy.period}>
          {(Object.keys(copy.periods) as AnalyticsPeriod[]).map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => {
            setPeriod(value);
            if (value === "custom" && report) { setFrom(report.range.from); setTo(report.range.to); }
          }}>{copy.periods[value]}</button>)}
        </div>
      </div>
      <div className="lres-filter-fields">
        {period === "custom" ? <div className="lres-custom-dates">
          <label className="lres-label" htmlFor={`${id}-from`}>{copy.from}<input id={`${id}-from`} className="adm-input" type="date" required min="2000-01-01" max="2100-12-31" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="lres-label" htmlFor={`${id}-to`}>{copy.to}<input id={`${id}-to`} className="adm-input" type="date" required min={from || "2000-01-01"} max="2100-12-31" value={to} onChange={event => setTo(event.target.value)} /></label>
        </div> : null}
        <label className="lres-label" htmlFor={`${id}-source`}>{copy.source}
          <select id={`${id}-source`} className="adm-input" value={source} onChange={event => setSource(event.target.value)}>
            <option value="all">{copy.allSources}</option>
            {source !== "all" && !sourceOptions.some(row => row.key === source) ? <option value={source}>{copy.selectedSource}</option> : null}
            {sourceOptions.map(row => <option key={row.key} value={row.key}>{sourceOptionName(row)}</option>)}
          </select>
        </label>
        <label className="lres-label" htmlFor={`${id}-responsible`}>{copy.responsible}
          <select id={`${id}-responsible`} className="adm-input" value={responsible} onChange={event => setResponsible(event.target.value)}>
            <option value="all">{copy.allAccounts}</option><option value="unassigned">{copy.unassigned}</option>
            {admins.map(admin => <option key={admin.id} value={admin.id}>{admin.email}</option>)}
          </select>
        </label>
        <button type="submit" className="adm-btn adm-btn-primary lres-apply" disabled={loading}>{copy.apply}<ArrowUpRight aria-hidden className="size-3.5" /></button>
      </div>
      <p className="lres-date-hint">{copy.dateHint}</p>
    </form>
    {error ? <div className="mt-5"><ErrorState text={error === "forbidden" ? copy.forbidden : error === "range" ? copy.rangeError : copy.failed} onRetry={error === "forbidden" ? undefined : refresh} /></div> : null}
    {loading ? <div className="lres-loading" role="status" aria-label={copy.loading}>
      <div className="lres-summary-grid"><div className="adm-skeleton h-80" /><div className="lres-metrics">{[0, 1, 2, 3].map(key => <div key={key} className="adm-skeleton h-38" />)}</div></div><div className="adm-skeleton h-96" /><span className="sr-only">{copy.loading}</span>
    </div> : null}
    {report ? <div className="lres-report">
      <div className="lres-report-meta">
        <p><span className="lres-live-dot" aria-hidden />{dateLabel(report.range.from)} — {dateLabel(report.range.to)} <span className="font-normal">{report.range.from.slice(0, 4) !== report.range.to.slice(0, 4) ? `${report.range.from.slice(0, 4)} / ${report.range.to.slice(0, 4)}` : report.range.to.slice(0, 4)} · Europe/Warsaw</span></p>
        <p className="font-normal">{copy.updated} <time dateTime={report.generatedAt}>{new Date(report.generatedAt).toLocaleString(t.locale, { timeZone: "Europe/Warsaw", hourCycle: "h23", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></p>
      </div>
      <div className="lres-summary-grid">
        <section className="lres-success" aria-labelledby={`${id}-success`}>
          <div className="lres-hero-art" aria-hidden><span /><span /><PartyPopper /></div>
          <div className="lres-hero-top"><span className="lres-hero-icon"><PartyPopper aria-hidden className="size-5" /></span><span className="lres-hero-check"><Check aria-hidden className="size-3" />{copy.successLegend}</span></div>
          <h2 id={`${id}-success`}>{copy.success}</h2>
          <div className="lres-hero-values"><p className="lres-hero-number">{number(report.totals.success)}</p><div className="lres-hero-ratio"><strong>{rate(report.rates.successOfAll)}</strong><span>{copy.successRate}</span><small>{number(report.totals.success)} / {number(total)}</small></div></div>
          <div className="lres-hero-footer"><div className="lres-hero-track" aria-hidden><span style={{ width: `${(report.rates.successOfAll ?? 0) * 100}%` }} /></div><p><ShieldCheck aria-hidden className="size-3.5" />{copy.successHint}</p></div>
        </section>
        <dl className="lres-metrics">
          {[
            { label: copy.allLeads, count: total, icon: Users, tone: "neutral", hint: copy.allHint, ratio: total ? 1 : 0, comparison: null },
            { label: copy.reviewed, count: report.totals.reviewed, icon: ClipboardCheck, tone: "blue", hint: copy.reviewedHint, ratio: total ? report.totals.reviewed / total : 0, comparison: `${percent(report.totals.reviewed, total)} · ${number(report.totals.reviewed)} / ${number(total)}` },
            { label: copy.suitable, count: report.totals.suitable, icon: Target, tone: "green", hint: copy.suitableRate, ratio: report.rates.suitableOfReviewed ?? 0, comparison: `${rate(report.rates.suitableOfReviewed)} · ${number(report.totals.suitable)} / ${number(report.totals.reviewed)}` },
            { label: copy.unreviewed, count: report.totals.unreviewed, icon: Clock3, tone: "amber", hint: copy.allLeads, ratio: total ? report.totals.unreviewed / total : 0, comparison: `${percent(report.totals.unreviewed, total)} · ${number(report.totals.unreviewed)} / ${number(total)}` },
          ].map(metric => <div key={metric.label} className={`adm-panel lres-metric lres-metric-${metric.tone}`}>
            <div className="lres-metric-top"><dt>{metric.label}</dt><span className={`lres-metric-icon lres-tone-${metric.tone}`}><metric.icon aria-hidden className="size-4" /></span></div>
            <div className="lres-metric-value"><dd>{number(metric.count)}</dd>{metric.comparison ? <span>{metric.comparison}</span> : null}</div>
            <dd className="lres-metric-hint">{metric.hint}</dd>
            <div className="lres-metric-track" aria-hidden><span style={{ width: `${metric.ratio * 100}%` }} /></div>
          </div>)}
        </dl>
      </div>
      <p className="lres-cohort"><ShieldCheck aria-hidden className="size-4 shrink-0" /><span>{copy.cohortHint}</span></p>
      {total === 0 ? <div className="adm-panel lres-empty"><span className="lres-empty-icon"><ArrowDownToLine aria-hidden className="size-6" /></span><div><h2>{copy.empty}</h2><p>{copy.emptyHint}</p></div></div> : null}
      <div className="lres-chart-grid">
        <section className="adm-panel lres-card lres-trend-card" aria-labelledby={`${id}-trend`}>
          <PanelHeading id={`${id}-trend`} title={copy.trend} hint={copy.trendHint} accessory={<span className="lres-section-icon"><Sparkles aria-hidden className="size-4" /></span>} />
          <DailyResultChart daily={report.daily} locale={t.locale} labels={copy} />
        </section>
        <section className="adm-panel lres-card" aria-labelledby={`${id}-outcomes`}>
          <PanelHeading id={`${id}-outcomes`} title={copy.outcomes} hint={copy.outcomesHint} />
          <LeadOutcomeDonut closures={report.closures} total={total} locale={t.locale} labels={copy} />
        </section>
      </div>
      {total > 0 ? <>
        <div className="lres-performance-grid">
          <section className="adm-panel lres-card lres-sources-card" aria-labelledby={`${id}-sources`}>
            <PanelHeading id={`${id}-sources`} title={copy.sources} hint={copy.sourceHint} accessory={<span className="lres-section-icon"><Globe2 aria-hidden className="size-4" /></span>} />
            <div className="lres-table-scroll"><table className="adm-table lres-table lres-source-table"><thead><tr>{[copy.source, copy.leads, copy.reviewed, copy.suitable, copy.successLegend, copy.conversion].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
              <tbody>{report.sources.map((row, index) => <tr key={row.key ?? `other-${index}`}>
                <th scope="row"><div className="lres-source-name"><span className="lres-source-avatar"><Globe2 aria-hidden className="size-4" /></span><div><strong>{sourceName(row)}</strong>{row.medium || row.campaign ? <div className="lres-source-tags">{row.medium ? <span title={copy.medium}>{row.medium}</span> : null}{row.campaign ? <span title={copy.campaign}>{row.campaign}</span> : null}</div> : null}</div></div></th>
                <td>{number(row.leads)}</td><td>{number(row.reviewed)}</td><td>{number(row.suitable)}</td><td className="lres-source-success">{number(row.success)}</td>
                <td><div className="lres-source-conversion"><strong>{percent(row.success, row.leads)}</strong><div aria-hidden><span style={{ width: `${row.leads ? row.success / row.leads * 100 : 0}%` }} /></div></div></td>
              </tr>)}</tbody>
            </table></div>
          </section>
          <section className="adm-panel lres-card lres-reasons-card" aria-labelledby={`${id}-reasons`}>
            <PanelHeading id={`${id}-reasons`} title={copy.reasons} hint={copy.reasonsHint} />
            {lost === 0 ? <div className="lres-no-losses"><span><CheckCircle2 aria-hidden className="size-6" /></span><p>{copy.noLosses}</p></div> : <>
              <div className="lres-loss-summary"><strong>{number(lost)}</strong><div><b>{percent(lost, total)}</b><span>{copy.lossRate}</span></div></div>
              <div className="lres-loss-stack" aria-hidden>{report.lossReasons.map(row => <span key={row.reason ?? "none"} className={`lres-reason-${row.reason ?? "none"}`} style={{ width: `${row.leads / lost * 100}%` }} />)}</div>
              <ul className="lres-loss-list">{report.lossReasons.map(row => <li key={row.reason ?? "none"} className={`lres-reason-${row.reason ?? "none"}`}><div><span className="lres-reason-dot" aria-hidden /><span className="lres-reason-name">{row.reason ? copy.reasonLabels[row.reason] : copy.noReason}</span><strong>{number(row.leads)}</strong><span className="lres-reason-share">{percent(row.leads, lost)}</span></div><div className="lres-loss-track" aria-hidden><span style={{ width: `${row.leads / lost * 100}%` }} /></div></li>)}</ul>
            </>}
          </section>
        </div>
        <section className="adm-panel lres-card" aria-labelledby={`${id}-list`}>
          <PanelHeading id={`${id}-list`} title={copy.list} accessory={<span className="lres-count-chip">{number(report.leads.total)}</span>} />
          <div className="lres-table-scroll"><table className="adm-table lres-table lres-lead-table"><thead><tr>{[copy.candidate, copy.qualification, copy.closure, copy.responsible, copy.source, copy.created].map(label => <th key={label} scope="col">{label}</th>)}<th scope="col"><span className="sr-only">{copy.edit}</span></th></tr></thead>
            <tbody>{report.leads.items.map(lead => <tr key={lead.id}>
              <th scope="row" className="min-w-40"><Link href={`/admin/leads/${lead.id}`} className="lres-lead-link" title={copy.viewLead}>{lead.name || copy.unnamed}<ArrowUpRight aria-hidden className="size-3 shrink-0" /></Link><p className="mt-1 text-[10.5px] font-normal text-adm-ink-3">#{lead.id}{lead.phone ? ` · ${lead.phone}` : ""}</p></th>
              <td><span className={`lres-badge lres-q-${lead.result.qualification}`}>{copy.qualifications[lead.result.qualification]}</span></td>
              <td className="min-w-40 max-w-60"><span className={`lres-badge lres-c-${lead.result.closure}`}><span className="lres-dot bg-current" aria-hidden />{copy.closures[lead.result.closure]}</span></td>
              <td className="max-w-44 break-all text-adm-ink-2">{lead.responsible?.email ?? copy.unassigned}</td>
              <td className="max-w-40 break-words text-adm-ink-3">{sourceName(lead.source)}{lead.source.campaign ? <p className="mt-1 text-[10.5px]">{lead.source.campaign}</p> : null}</td>
              <td className="whitespace-nowrap text-adm-ink-3"><time dateTime={lead.createdAt}>{new Date(lead.createdAt).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" })}</time></td>
              <td><button type="button" className="adm-btn adm-btn-sm" data-lead-result-edit={lead.id} onClick={() => setEditor({ id: String(lead.id), name: lead.name || copy.unnamed })} aria-label={`${copy.edit}: ${lead.name || `#${lead.id}`}`}>{copy.edit}</button></td>
            </tr>)}</tbody>
          </table></div>
          <div className="lres-pagination"><span className="text-[11.5px] text-adm-ink-3 tabular-nums">{copy.page} {report.leads.page} {copy.of} {Math.max(1, report.leads.pages)} · {number(report.leads.total)} {copy.leads.toLocaleLowerCase(t.locale)}</span><div className="flex gap-2"><button type="button" className="adm-btn adm-btn-sm" disabled={loading || report.leads.page <= 1} onClick={() => runQuery({ ...query, page: report.leads.page - 1 })}><ChevronLeft aria-hidden className="size-3.5" />{copy.previous}</button><button type="button" className="adm-btn adm-btn-sm" disabled={loading || report.leads.page >= report.leads.pages} onClick={() => runQuery({ ...query, page: report.leads.page + 1 })}>{copy.next}<ChevronRight aria-hidden className="size-3.5" /></button></div></div>
        </section>
      </> : null}
      <p className="lres-internal-hint flex items-start gap-2"><LockKeyhole aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{copy.internalHint}</span></p>
    </div> : null}
    {editor ? <ResultDialog leadId={editor.id} name={editor.name} onClose={() => setEditor(null)} onSaved={refresh} /> : null}
  </div>;
}
