"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { analyticsCopy, type AnalyticsPeriod, type AnalyticsReport, type AnalyticsSource, type FunnelCounts } from "@/config/analytics";
import { useAdminI18n } from "@/components/admin/i18n";
import { EmptyState, ErrorState, PageHeader } from "@/components/admin/ui";
import { api, ApiError } from "@/lib/api";

type Query = { period: AnalyticsPeriod; from?: string; to?: string };

export default function AnalyticsPage() {
  const { lang, t } = useAdminI18n();
  const copy = analyticsCopy[lang];
  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState<Query>({ period: "30d" });
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<"range" | "load" | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ period: query.period });
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    void api<AnalyticsReport>(`/api/admin/analytics?${params}`, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        setReport(data);
        setError(null);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof ApiError && reason.code === "analytics_range" ? "range" : "load");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, reload]);

  const percent = (value: number, total: number) => total ? `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(value / total * 100)}%` : "—";
  const number = (value: number) => new Intl.NumberFormat(t.locale).format(value);
  const milestones: { key: keyof FunnelCounts; label: string }[] = [
    { key: "sessions", label: copy.sessions }, { key: "contacts", label: copy.contacts },
    { key: "questions", label: copy.questions }, { key: "taskViewed", label: copy.taskViewed }, { key: "submitted", label: copy.submitted },
  ];
  const sourceName = (source: AnalyticsSource) => source.kind === "unknown" ? copy.unknown : source.kind === "direct" ? copy.direct
    : source.kind === "other" ? copy.other : source.source ?? copy.untagged;
  const requestRefresh = () => { setLoading(true); setReload(value => value + 1); };

  return (
    <div>
      <PageHeader title={copy.title} description={copy.description} actions={
        <button type="button" className="adm-btn adm-btn-sm" disabled={loading} onClick={requestRefresh}>
          <RefreshCw aria-hidden className={`size-3.5 ${loading ? "animate-spin" : ""}`} />{copy.refresh}
        </button>
      } />
      <form className="adm-panel mb-4 flex flex-wrap items-end gap-3 p-4" onSubmit={event => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        setReport(null);
        setQuery(period === "custom" ? { period, from, to } : { period });
      }}>
        <label className="grid gap-1 text-[12px] font-semibold" htmlFor="analytics-period">
          {copy.period}
          <select id="analytics-period" className="adm-input min-w-44" value={period} onChange={event => {
            const next = event.target.value as AnalyticsPeriod;
            setPeriod(next);
            if (next === "custom" && report) { setFrom(report.range.from); setTo(report.range.to); }
          }}>
            {Object.entries(copy.periods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {period === "custom" ? <>
          <label className="grid gap-1 text-[12px] font-semibold" htmlFor="analytics-from">{copy.from}
            <input id="analytics-from" className="adm-input" type="date" min="2000-01-01" max="2100-12-31" required value={from} onChange={event => setFrom(event.target.value)} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold" htmlFor="analytics-to">{copy.to}
            <input id="analytics-to" className="adm-input" type="date" required value={to} min={from || "2000-01-01"} max="2100-12-31" onChange={event => setTo(event.target.value)} />
          </label>
        </> : null}
        <button className="adm-btn adm-btn-primary" disabled={loading} type="submit">{copy.apply}</button>
        <p className="w-full text-[12px] text-adm-ink-3">{copy.dateHint}</p>
      </form>
      {error ? <div className="mb-4"><ErrorState text={error === "range" ? copy.rangeError : copy.failed} onRetry={requestRefresh} /></div> : null}
      {loading && !report ? <div className="adm-skeleton h-64" role="status" aria-label={copy.loading} /> : null}
      {report ? <div aria-busy={loading}>
        <p className="mb-3 text-[12px] text-adm-ink-3 tabular-nums">{report.range.from} — {report.range.to} · {copy.zoneLabel} · {copy.updated} {new Date(report.generatedAt).toLocaleString(t.locale, { timeZone: report.range.timezone, hourCycle: "h23" })}</p>
        <p className="mb-4 max-w-5xl text-[13px] leading-relaxed text-adm-ink-2">{copy.cohortHint}</p>
        {report.totals.sessions === 0 ? <div className="adm-panel"><EmptyState text={copy.empty} /></div> : <>
          <dl className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {milestones.map(({ key, label }, index) => <div key={key} className="adm-panel min-w-0 p-4">
              <dt className="min-h-9 text-[12px] font-semibold text-adm-ink-2"><span className="mr-1.5 text-adm-ink-3">{index + 1}.</span>{label}</dt>
              <dd className="mt-2 text-[30px] leading-tight font-bold tabular-nums">{number(report.totals[key])}</dd>
              <dd className="mt-1 text-[12px] text-adm-ink-3">{percent(report.totals[key], report.totals.sessions)} {copy.ofCohort}</dd>
              <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-adm-line"><div className="h-full rounded-full bg-adm-accent" style={{ width: `${report.totals[key] / report.totals.sessions * 100}%` }} /></div>
            </div>)}
          </dl>
          <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
            <div><dt className="inline text-adm-ink-3">{copy.coverage}: </dt><dd className="inline font-semibold tabular-nums">{number(report.totals.attributed)} / {number(report.totals.sessions)} · {percent(report.totals.attributed, report.totals.sessions)}</dd></div>
            <div><dt className="inline text-adm-ink-3">{copy.active}: </dt><dd className="inline font-semibold tabular-nums">{number(report.totals.active)} / {number(report.totals.sessions)}</dd></div>
          </dl>
          <section className="adm-panel overflow-hidden" aria-labelledby="analytics-sources-title">
            <h2 id="analytics-sources-title" className="border-b border-adm-line px-4 py-3 text-[14px] font-semibold">{copy.sources}</h2>
            <div className="overflow-x-auto">
              <table className="adm-table w-full text-left text-[12.5px]">
                <thead><tr>
                  {[copy.source, copy.medium, copy.campaign, copy.sessions, copy.contacts, copy.questions, copy.taskViewed, copy.submitted, copy.conversion].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}
                </tr></thead>
                <tbody>{report.sources.map((source, index) => <tr key={JSON.stringify([source.kind, source.source, source.medium, source.campaign])} className={index % 2 ? "bg-adm-subtle/40" : ""}>
                  <th scope="row" className="max-w-60 px-4 py-3 font-medium break-words">{sourceName(source)}</th>
                  <td className="max-w-40 px-4 py-3 break-words">{source.medium ?? "—"}</td>
                  <td className="max-w-52 px-4 py-3 break-words">{source.campaign ?? "—"}</td>
                  {milestones.map(({ key }) => <td key={key} className="px-4 py-3 tabular-nums">{number(source[key])}</td>)}
                  <td className="px-4 py-3 tabular-nums">{percent(source.submitted, source.sessions)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>
        </>}
        <div className="mt-4 max-w-5xl space-y-2 text-[12px] leading-relaxed text-adm-ink-3">
          <p>{copy.sourceHint}</p><p>{copy.taskHint}</p><p>{copy.activityHint}</p><p>{copy.privacyHint}</p>
        </div>
      </div> : null}
    </div>
  );
}
