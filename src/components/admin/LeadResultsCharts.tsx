"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, Circle } from "lucide-react";
import type { LeadClosure, LeadResultsReport } from "@/config/lead-results";
import { leadResultsCopy } from "@/config/lead-results-copy";

type Labels = typeof leadResultsCopy.en;
type Point = { x: number; y: number };
const OUTCOME_ORDER: LeadClosure[] = ["signal_working", "open", "not_suitable", "candidate_declined", "no_contact"];
const round = (value: number) => Math.round(value * 100) / 100;

/** Every Bézier control stays inside its data interval, so curves cannot invent peaks or negative values. */
export function boundedLinePath(points: readonly Point[]): string {
  if (!points.length) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const handle = (point.x - previous.x) * 0.42;
    return `${path} C ${round(previous.x + handle)} ${round(previous.y)}, ${round(point.x - handle)} ${round(point.y)}, ${round(point.x)} ${round(point.y)}`;
  }, `M ${round(points[0].x)} ${round(points[0].y)}`);
}

export function DailyResultChart({ daily, locale, labels }: { daily: LeadResultsReport["daily"]; locale: string; labels: Labels }) {
  const id = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const axisNumbers = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale]);
  const dates = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "Europe/Warsaw" }), [locale]);
  const fullDates = useMemo(() => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Warsaw" }), [locale]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = Math.round(entries[0]?.contentRect.width ?? element.clientWidth);
      if (nextWidth > 0) setWidth(Math.max(240, nextWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const model = useMemo(() => {
    const max = daily.reduce((value, day) => Math.max(value, day.leads, day.success), 0);
    const scaleMax = max || 1;
    const left = 38;
    const right = width - 14;
    const bottom = 206;
    const plotHeight = 176;
    const point = (value: number, index: number): Point => ({
      x: daily.length <= 1 ? (left + right) / 2 : left + index / (daily.length - 1) * (right - left),
      y: bottom - value / scaleMax * plotHeight,
    });
    const leads = daily.map((day, index) => point(day.leads, index));
    const success = daily.map((day, index) => point(day.success, index));
    const leadPath = boundedLinePath(leads);
    const successPath = boundedLinePath(success);
    const area = (path: string, points: Point[]) => points.length > 1 ? `${path} L ${round(points.at(-1)!.x)} ${bottom} L ${round(points[0].x)} ${bottom} Z` : "";
    const tickCount = width < 420 ? 3 : 5;
    const tickIndices = Array.from(new Set(Array.from({ length: Math.min(tickCount, daily.length) }, (_, index) => Math.round(index / Math.max(1, Math.min(tickCount, daily.length) - 1) * Math.max(0, daily.length - 1)))));
    const yTicks = max > 1 ? Array.from(new Set([0, Math.ceil(max / 2), max])) : max === 1 ? [0, 1] : [0];
    return { max, scaleMax, left, right, bottom, plotHeight, leads, success, leadPath, successPath, leadArea: area(leadPath, leads), successArea: area(successPath, success), tickIndices, yTicks,
      totalLeads: daily.reduce((sum, day) => sum + day.leads, 0), totalSuccess: daily.reduce((sum, day) => sum + day.success, 0) };
  }, [daily, width]);

  const selectedIndex = active === null || !daily.length ? null : Math.min(active, daily.length - 1);
  const selected = selectedIndex === null ? null : daily[selectedIndex];
  const selectedPoint = selectedIndex === null ? null : model.leads[selectedIndex];
  const shortDate = (value: string) => dates.format(new Date(`${value}T12:00:00Z`));
  const fullDate = (value: string) => fullDates.format(new Date(`${value}T12:00:00Z`));
  const tooltipWidth = Math.min(215, width - 20);
  const tooltipLeft = selectedPoint ? Math.max(10, Math.min(selectedPoint.x - tooltipWidth / 2, width - tooltipWidth - 10)) : 0;
  const inspectPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!daily.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * width;
    setActive(Math.max(0, Math.min(daily.length - 1, Math.round((x - model.left) / (model.right - model.left) * (daily.length - 1)))));
  };
  const inspectKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!daily.length) return;
    if (event.key === "Escape") { setActive(null); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setActive(current => event.key === "Home" ? 0 : event.key === "End" ? daily.length - 1
      : Math.max(0, Math.min(daily.length - 1, (current ?? daily.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
  };

  return <div className="lres-daily-chart">
    <div className="lres-series-summary">
      <div><span className="lres-series-label"><i className="lres-line-key lres-line-leads" aria-hidden />{labels.leadsLegend}</span><strong>{numbers.format(model.totalLeads)}</strong></div>
      <div><span className="lres-series-label"><i className="lres-line-key lres-line-success" aria-hidden />{labels.successLegend}</span><strong className="text-adm-accent">{numbers.format(model.totalSuccess)}</strong></div>
    </div>
    <div ref={container} className="lres-chart-interactive" tabIndex={daily.length ? 0 : -1} role="group" aria-label={labels.trend}
      aria-describedby={`${id}-help ${id}-selected`} aria-keyshortcuts="ArrowLeft ArrowRight Home End Escape"
      onPointerMove={inspectPointer} onPointerDown={event => { inspectPointer(event); if (event.pointerType === "touch") event.currentTarget.focus({ preventScroll: true }); }} onPointerLeave={event => { if (event.pointerType !== "touch" && document.activeElement !== event.currentTarget) setActive(null); }}
      onFocus={() => setActive(current => current ?? Math.max(0, daily.length - 1))} onBlur={() => setActive(null)} onKeyDown={inspectKey}>
      <svg className="lres-area-chart" viewBox={`0 0 ${width} 244`} aria-hidden>
        <defs>
          <linearGradient id={`${id}-leads-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2={model.bottom}><stop className="lres-leads-fill-top" offset="0%" stopColor="var(--lres-chart-leads)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--lres-chart-leads)" stopOpacity=".02" /></linearGradient>
          <linearGradient id={`${id}-success-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2={model.bottom}><stop className="lres-success-fill-top" offset="0%" stopColor="var(--lres-success)" stopOpacity=".34" /><stop offset="100%" stopColor="var(--lres-success)" stopOpacity=".035" /></linearGradient>
          <linearGradient id={`${id}-success-line`} gradientUnits="userSpaceOnUse" x1={model.left} y1="0" x2={model.right} y2="0"><stop stopColor="var(--lres-success-start)" /><stop offset="100%" stopColor="var(--lres-success)" /></linearGradient>
        </defs>
        {model.yTicks.map(value => {
          const y = model.bottom - value / model.scaleMax * model.plotHeight;
          return <g key={value}><line x1={model.left} x2={model.right} y1={y} y2={y} stroke="var(--color-adm-line)" strokeDasharray={value ? "3 6" : undefined} /><text x={model.left - 10} y={y + 3} textAnchor="end" className="lres-chart-label">{axisNumbers.format(value)}</text></g>;
        })}
        {model.max > 0 ? <><path d={model.leadArea} fill={`url(#${id}-leads-fill)`} /><path d={model.successArea} fill={`url(#${id}-success-fill)`} /><path className="lres-chart-leads-line" d={model.leadPath} fill="none" stroke="var(--lres-chart-leads)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /><path className="lres-chart-success-line" d={model.successPath} fill="none" stroke={`url(#${id}-success-line)`} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></> : null}
        {daily.length === 1 ? <><circle cx={model.leads[0].x} cy={model.leads[0].y} r="4" fill="var(--lres-chart-leads)" /><circle cx={model.success[0].x} cy={model.success[0].y} r="3" fill="var(--lres-success)" /></> : null}
        {model.tickIndices.map(index => <text key={daily[index].date} x={model.leads[index].x} y="232" textAnchor={index === 0 ? "start" : index === daily.length - 1 ? "end" : "middle"} className="lres-chart-label">{shortDate(daily[index].date)}</text>)}
        {selectedPoint && selectedIndex !== null ? <g><line x1={selectedPoint.x} x2={selectedPoint.x} y1="18" y2={model.bottom} stroke="var(--color-adm-ink-3)" strokeOpacity=".45" strokeDasharray="3 4" />
          <circle cx={selectedPoint.x} cy={selectedPoint.y} r="5" fill="var(--lres-chart-leads)" stroke="var(--color-adm-surface)" strokeWidth="2.5" /><circle cx={model.success[selectedIndex].x} cy={model.success[selectedIndex].y} r="5" fill="var(--lres-success)" stroke="var(--color-adm-surface)" strokeWidth="2.5" /></g> : null}
      </svg>
      {selected && selectedPoint ? <div className="lres-chart-tooltip" style={{ left: `${tooltipLeft / width * 100}%`, width: tooltipWidth }} aria-hidden>
        <p>{fullDate(selected.date)}</p><div><span><i className="lres-dot" style={{ background: "var(--lres-chart-leads)" }} />{labels.leadsLegend}</span><strong>{numbers.format(selected.leads)}</strong></div><div><span><i className="lres-dot lres-fill-signal_working" />{labels.successLegend}</span><strong>{numbers.format(selected.success)}</strong></div>
      </div> : null}
    </div>
    <p className="lres-chart-help" id={`${id}-help`}>{labels.chartHint}</p>
    <p id={`${id}-selected`} className="sr-only" aria-live="polite" aria-atomic="true">{selected ? `${fullDate(selected.date)}. ${labels.leadsLegend}: ${numbers.format(selected.leads)}. ${labels.successLegend}: ${numbers.format(selected.success)}.` : ""}</p>
    <details className="lres-daily-data"><summary>{labels.dailyData}<ChevronDown aria-hidden className="size-3.5" /></summary><div className="max-h-60 overflow-auto" tabIndex={0} role="region" aria-label={labels.dailyData}><table className="adm-table lres-table"><thead><tr><th scope="col">{labels.date}</th><th scope="col">{labels.leadsLegend}</th><th scope="col">{labels.successLegend}</th></tr></thead><tbody>{daily.map(day => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{day.date}</time></th><td>{numbers.format(day.leads)}</td><td>{numbers.format(day.success)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

function arcPath(start: number, end: number, radius: number) {
  const point = (angle: number) => ({ x: 104 + radius * Math.cos(angle), y: 104 + radius * Math.sin(angle) });
  const a = point(start);
  const b = point(end);
  return `M ${round(a.x)} ${round(a.y)} A ${radius} ${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${round(b.x)} ${round(b.y)}`;
}

export function LeadOutcomeDonut({ closures, total, locale, labels }: { closures: LeadResultsReport["closures"]; total: number; locale: string; labels: Labels }) {
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale]);
  const percents = useMemo(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }), [locale]);
  const segments = useMemo(() => {
    const nonzero = OUTCOME_ORDER.filter(key => closures[key] > 0);
    return OUTCOME_ORDER.map((key, index) => {
      const ratio = total ? closures[key] / total : 0;
      const start = OUTCOME_ORDER.slice(0, index).reduce((sum, previous) => sum + closures[previous], 0) / (total || 1) * Math.PI * 2 - Math.PI / 2;
      const sweep = ratio * Math.PI * 2;
      const gap = nonzero.length > 1 ? Math.min(.065, sweep * .22) : 0;
      const stroke = Math.min(18, (sweep - gap) * 76 * .5);
      const capAngle = stroke / 76;
      return { key, ratio, full: nonzero.length === 1 && ratio > 0, stroke, path: sweep > 0 ? arcPath(start + gap / 2 + capAngle / 2, start + sweep - gap / 2 - capAngle / 2, 76) : "" };
    });
  }, [closures, total]);

  return <div className="lres-outcomes">
    <div className="lres-donut" aria-hidden><svg viewBox="0 0 208 208"><circle cx="104" cy="104" r="93" fill="none" stroke="var(--color-adm-line)" strokeWidth="1" strokeDasharray="1 7" /><circle cx="104" cy="104" r="76" fill="none" stroke="var(--color-adm-subtle)" strokeWidth="18" />
      {segments.map(segment => segment.ratio > 0 ? segment.full ? <circle key={segment.key} className={`lres-stroke-${segment.key}`} cx="104" cy="104" r="76" fill="none" strokeWidth="18" /> : <path key={segment.key} d={segment.path} className={`lres-stroke-${segment.key}`} fill="none" strokeWidth={segment.stroke} strokeLinecap="round" /> : null)}
    </svg><div><span className="lres-donut-caption">{labels.allLeads}</span><strong title={numbers.format(total)}>{total >= 100_000 ? compact.format(total) : numbers.format(total)}</strong><span className="lres-donut-subtotal"><Circle className="size-2" fill="currentColor" />{numbers.format(closures.signal_working)} {labels.successLegend.toLocaleLowerCase(locale)}</span></div></div>
    <ul className="lres-outcome-legend">{OUTCOME_ORDER.map(key => <li key={key}><div className="lres-outcome-row"><span className={`lres-legend-mark lres-fill-${key}`} aria-hidden /><span className="lres-outcome-name">{labels.closures[key]}</span><strong>{numbers.format(closures[key])}</strong><span className="lres-outcome-percent">{total ? percents.format(closures[key] / total) : "—"}</span></div><div className="lres-outcome-track" aria-hidden><span className={`lres-fill-${key}`} style={{ width: `${total ? closures[key] / total * 100 : 0}%` }} /></div></li>)}</ul>
  </div>;
}
