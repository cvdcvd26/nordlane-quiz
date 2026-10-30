"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { LEAD_STATUSES, QUESTION_KEYS, type LeadStatus } from "@/config/content";
import { api } from "@/lib/api";
import type { ManagerProfile } from "@/config/managers";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { EmptyState, ErrorState, PageHeader, SkeletonRows, StageTrack, StatusFilter, StatusSelect } from "@/components/admin/ui";
import { toast } from "@/components/admin/toast";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { useAdminI18n } from "@/components/admin/i18n";
import { inboxCopy } from "@/config/admin-inbox";
import { workflowCopy } from "@/config/admin-workflow";

const displayPhone = (p: string) => formatPhone(nationalDigits(p));

type Item = {
  manager: ManagerProfile;
  id: number;
  status: LeadStatus;
  createdAt: string;
  submittedAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  answer: string | null;
  contactName: string | null;
  contactPhone: string | null;
  stage: string;
  answered: number;
  needsReply: boolean;
  isUnfinished: boolean;
  replyWaitingSince: string | null;
  lastVisitorMessage: string | null;
  lastSeenAt: string;
  isActive: boolean;
};
type ListResponse = { items: Item[]; total: number; needsReplyCount: number; unfinishedCount: number; submittedCount: number; page: number; pageSize: number };
type Filters = { q: string; status: string; sort: "desc" | "asc"; page: number; queue: "all" | "submitted" | "needs_reply" | "unfinished"; stage: string; inactiveMinutes: number };

const fromParams = (p: URLSearchParams): Filters => ({
  q: p.get("q") ?? "",
  status: p.get("status") ?? "",
  sort: p.get("sort") === "asc" ? "asc" : "desc",
  page: Number(p.get("page")) || 1,
  queue: ["submitted", "needs_reply", "unfinished"].includes(p.get("queue") ?? "") ? p.get("queue") as Filters["queue"] : "all",
  stage: ["questions", "task"].includes(p.get("stage") ?? "") ? p.get("stage")! : "",
  inactiveMinutes: p.has("inactiveMinutes") ? Math.max(0, Math.min(10080, Number(p.get("inactiveMinutes")) || 0)) : p.get("queue") === "unfinished" ? 30 : 0,
});

const toParams = (f: Filters) => {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.status) params.set("status", f.status);
  if (f.sort !== "desc") params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
  if (f.queue !== "all") params.set("queue", f.queue);
  if (f.queue === "unfinished") {
    if (f.stage) params.set("stage", f.stage);
    params.set("inactiveMinutes", String(f.inactiveMinutes));
  }
  return params.toString();
};

const COLS = 8;

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="adm-skeleton h-64" aria-busy />}>
      <Leads />
    </Suspense>
  );
}

function Leads() {
  const { lang, t, time, err: tErr } = useAdminI18n();
  const L = t.ui.list;
  const I = inboxCopy[lang];
  const W = workflowCopy[lang];
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => fromParams(new URLSearchParams(searchParams.toString())));
  const [query, setQuery] = useState(filters.q);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const key = toParams(filters);
  const loading = loadedKey !== `${key}#${reload}`;

  useEffect(() => {
    window.history.replaceState(null, "", `/admin${key ? `?${key}` : ""}`);
    let cancelled = false;
    api<ListResponse>(`/api/admin/leads?${key}`)
      .then((d) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(d.total / d.pageSize));
        if (d.page > lastPage) { setFilters(current => ({ ...current, page: lastPage })); return; }
        setNow(Date.now());
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(tErr(e)))
      .finally(() => !cancelled && setLoadedKey(`${key}#${reload}`));
    return () => {
      cancelled = true;
    };
  }, [key, reload, tErr]);

  // New lead / message anywhere → refresh the list.
  useEffect(() => {
    const onActivity = () => setReload((n) => n + 1);
    const timer = setInterval(() => { if (document.visibilityState === "visible") onActivity(); }, 8000);
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => { clearInterval(timer); window.removeEventListener(ACTIVITY_EVENT, onActivity); };
  }, []);

  // Debounced search.
  useEffect(() => {
    if (query === filters.q) return;
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: query, page: 1 })), 350);
    return () => clearTimeout(timer);
  }, [query, filters.q]);

  const pageIds = data?.items.map((l) => l.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected((s) => {
      const n = new Set(s);
      pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id)));
      return n;
    });

  const changeStatus = async (id: number, status: LeadStatus) => {
    const prev = data;
    setSaving(id);
    setData((d) => d && { ...d, items: d.items.map((i) => (i.id === id ? { ...i, status } : i)) });
    try {
      await api(`/api/admin/leads/${id}`, { method: "PATCH", json: { status } });
      toast({ kind: "success", title: t.ui.workflow.statusChanged(id, t.ui.statuses[status]) });
    } catch (e) {
      setData(prev);
      toast({ kind: "error", title: tErr(e) });
    } finally {
      setSaving(null);
    }
  };

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      const { deleted } = await api<{ deleted: number }>("/api/admin/leads", { method: "DELETE", json: { ids: [...selected] } });
      setSelected(new Set());
      setConfirming(false);
      toast({ kind: "success", title: L.deleted(deleted) });
      setReload((n) => n + 1);
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
    } finally {
      setDeleting(false);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div>
      <PageHeader title={L.title} meta={data ? L.total(data.total) : undefined} description={L.description} />

      <div role="group" aria-label={I.filter} className="mb-3 flex flex-wrap gap-2">
        {(["all", "submitted", "needs_reply", "unfinished"] as const).map(queue => (
          <button key={queue} type="button" aria-pressed={filters.queue === queue}
            onClick={() => { setSelected(new Set()); setFilters(current => ({ ...current, queue, stage: "", inactiveMinutes: queue === "unfinished" ? 30 : 0, page: 1 })); }}
            className={`adm-btn ${filters.queue === queue ? "border-adm-accent! bg-adm-accent-soft! text-adm-accent!" : ""}`}>
            {queue === "all" ? I.all : queue === "submitted" ? W.submitted : queue === "needs_reply" ? I.needsReply : W.unfinished}
            {queue === "submitted" && data && <span className="rounded-full bg-adm-green-bg px-2 py-0.5 text-[11px] text-adm-green tabular-nums">{data.submittedCount}</span>}
            {queue === "needs_reply" && data && <span className="rounded-full bg-adm-amber-bg px-2 py-0.5 text-[11px] text-adm-amber tabular-nums">{data.needsReplyCount}</span>}
            {queue === "unfinished" && data && <span className="rounded-full bg-adm-subtle px-2 py-0.5 text-[11px] text-adm-ink-2 tabular-nums">{data.unfinishedCount}</span>}
          </button>
        ))}
      </div>
      {filters.queue === "submitted" && <p className="adm-help mb-3 max-w-3xl leading-relaxed">{W.submittedHint}</p>}
      {filters.queue === "needs_reply" && <p className="adm-help mb-3 max-w-3xl leading-relaxed">{I.hint}</p>}
      {filters.queue === "unfinished" && <div className="mb-3 space-y-2">
        <p className="adm-help max-w-3xl leading-relaxed">{W.unfinishedHint}</p>
        <div className="flex flex-wrap gap-3">
          <label className="adm-label">{W.stage}<select className="adm-input mt-1 w-auto" value={filters.stage} onChange={event => { setSelected(new Set()); setFilters(f => ({ ...f, stage: event.target.value, page: 1 })); }}>
            <option value="">{W.allStages}</option><option value="questions">{W.questions}</option><option value="task">{W.task}</option>
          </select></label>
          <label className="adm-label">{W.inactive}<select className="adm-input mt-1 w-auto" value={filters.inactiveMinutes} onChange={event => { setSelected(new Set()); setFilters(f => ({ ...f, inactiveMinutes: Number(event.target.value), page: 1 })); }}>
            <option value={0}>{W.anyActivity}</option>{[5, 30, 120, 1440].map(n => <option key={n} value={n}>{W.minutes(n)}</option>)}
          </select></label>
        </div>
      </div>}

      {/* Toolbar or bulk actions */}
      <div className="adm-panel">
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-adm-line px-3 py-2">
          {selected.size > 0 ? (
            <>
              <span className="text-[13px] font-semibold">{L.selected(selected.size)}</span>
              {confirming ? (
                <>
                  <span className="text-[13px] text-adm-ink-2">{L.confirmDeleteMany(selected.size)}</span>
                  <div className="ml-auto flex gap-2">
                    <button type="button" className="adm-btn" onClick={() => setConfirming(false)} disabled={deleting}>
                      {L.cancel}
                    </button>
                    <button type="button" className="adm-btn adm-btn-danger-solid" onClick={() => void deleteSelected()} disabled={deleting}>
                      {deleting ? t.ui.lead.deleting : L.confirmYes}
                    </button>
                  </div>
                </>
              ) : (
                <div className="ml-auto flex gap-2">
                  <button type="button" className="adm-btn adm-btn-quiet" onClick={() => setSelected(new Set())}>
                    {L.clearSelection}
                  </button>
                  <button type="button" className="adm-btn adm-btn-danger" onClick={() => setConfirming(true)}>
                    <Trash2 aria-hidden className="size-3.5" />
                    {L.deleteSelected}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="relative min-w-52 flex-1 sm:max-w-sm">
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-adm-ink-3" />
                <label className="sr-only" htmlFor="q">
                  {L.search}
                </label>
                <input id="q" type="search" className="adm-input pl-8" placeholder={L.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <label className="sr-only" htmlFor="status">
                {L.status}
              </label>
              <StatusFilter
                id="status"
                label={L.status}
                allLabel={L.allStatuses}
                value={LEAD_STATUSES.includes(filters.status as LeadStatus) ? filters.status as LeadStatus : ""}
                onChange={(status) => setFilters((f) => ({ ...f, status, page: 1 }))}
              />
              <label className="sr-only" htmlFor="sort">
                {L.sortLabel}
              </label>
              <select
                id="sort"
                className="adm-input w-auto"
                value={filters.sort}
                disabled={filters.queue === "needs_reply" || filters.queue === "unfinished"}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"], page: 1 }))}
              >
                <option value="desc">{filters.queue === "needs_reply" ? I.oldestFirst : filters.queue === "unfinished" ? W.oldestActivity : filters.queue === "submitted" ? W.newestSubmitted : L.newestFirst}</option>
                <option value="asc">{filters.queue === "needs_reply" ? I.oldestFirst : filters.queue === "submitted" ? W.oldestSubmitted : L.oldestFirst}</option>
              </select>
            </>
          )}
        </div>

        {error && (
          <div className="p-3">
            <ErrorState text={error} onRetry={() => setReload((n) => n + 1)} />
          </div>
        )}

        <div className={`overflow-x-auto transition-opacity ${loading && data ? "opacity-60" : ""}`}>
          <table className="adm-table min-w-[880px]">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" className="adm-check" aria-label={L.selectAll} checked={allOnPage} onChange={toggleAll} disabled={!pageIds.length} />
                </th>
                <th>{L.columns.contact}</th>
                <th>{L.columns.stage}</th>
                <th>{L.columns.status}</th>
                <th>{L.columns.answer}</th>
                <th>{filters.queue === "needs_reply" ? I.latest : L.columns.lastMessage}</th>
                <th className="text-right">{L.columns.messages}</th>
                <th>{filters.queue === "submitted" ? W.submittedAt : L.columns.created}</th>
              </tr>
            </thead>
            <tbody>
              {!data && !error && <SkeletonRows cols={COLS} />}
              {data?.items.map((l) => (
                <tr key={l.id} className={`relative ${selected.has(l.id) ? "[&>td]:bg-adm-accent-soft" : ""}`}>
                  <td className="relative z-10 w-10">
                    <input type="checkbox" className="adm-check" aria-label={L.selectOne(l.id)} checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} />
                  </td>
                  <td>
                    <Link href={`/admin/leads/${l.id}${key ? `?${key}` : ""}`} className="font-semibold after:absolute after:inset-0 hover:text-adm-accent">
                      {l.contactName ?? "—"}
                    </Link>
                    <span className="block text-[12.5px] whitespace-nowrap text-adm-ink-3 tabular-nums">
                      #{l.id}
                      {l.contactPhone ? ` · ${displayPhone(l.contactPhone)}` : ""}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-adm-accent">{l.manager.name}</span>
                    {(l.needsReply || l.isUnfinished) && <div className="mt-1 flex flex-wrap gap-1">
                      {l.needsReply && <span className="inline-block rounded-full bg-adm-amber-bg px-2 py-0.5 text-[11px] font-semibold text-adm-amber">{I.needsReply}</span>}
                      {l.isUnfinished && <span className="inline-block rounded-full bg-[#eaf0f8] px-2 py-0.5 text-[11px] font-semibold text-[#41638a]">{W.unfinishedBadge}</span>}
                    </div>}
                  </td>
                  <td>
                    <StageTrack stage={l.stage} answered={l.answered} total={QUESTION_KEYS.length} />
                    <span className={`mt-1 block text-[11.5px] ${l.isActive ? "text-adm-green" : "text-adm-ink-3"}`}>
                      {l.isActive ? W.active : `${W.lastActive}: ${time(l.lastSeenAt)}`}
                    </span>
                  </td>
                  <td className="relative z-10">
                    <StatusSelect value={l.status} label={L.statusFor(l.id)} disabled={saving === l.id} onChange={(s) => void changeStatus(l.id, s)} />
                  </td>
                  <td className="whitespace-nowrap text-adm-ink-2">{l.answer ? l.answer.split(",").map((x) => t.ui.answers[x] ?? x).join(" · ") : "—"}</td>
                  <td className="text-adm-ink-2">
                    {filters.queue === "needs_reply" && <span className="mb-1 block max-w-64 truncate text-[13px]" title={l.lastVisitorMessage || I.attachment}>{l.lastVisitorMessage || I.attachment}</span>}
                    {l.replyWaitingSince ? <>
                      <span className="block whitespace-nowrap text-[12px] font-semibold text-adm-amber tabular-nums">{I.waiting(Math.max(0, Math.floor((now - Date.parse(l.replyWaitingSince)) / 60000)))}</span>
                      <span className="block whitespace-nowrap text-[12px] text-adm-ink-3 tabular-nums">{time(l.replyWaitingSince)}</span>
                    </> : <span className="whitespace-nowrap tabular-nums">{l.lastMessageAt ? time(l.lastMessageAt) : "—"}</span>}
                  </td>
                  <td className="text-right text-adm-ink-2 tabular-nums">{l.messageCount}</td>
                  <td className="whitespace-nowrap text-adm-ink-2 tabular-nums">{filters.queue === "submitted" ? l.submittedAt ? time(l.submittedAt) : "—" : time(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <EmptyState text={filters.q || filters.status ? L.noResults : filters.queue === "needs_reply" ? I.empty : filters.queue === "submitted" ? W.submittedEmpty : L.empty} />}
        </div>

        {data && data.total > 0 && (
          <nav className="flex items-center gap-3 border-t border-adm-line px-3 py-2" aria-label={L.pages}>
            <span className="text-[13px] text-adm-ink-3 tabular-nums">{L.range(from, to, data.total)}</span>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="adm-btn adm-btn-sm"
                disabled={data.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                <ChevronLeft aria-hidden className="size-3.5" />
                {L.prev}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn-sm"
                disabled={data.page >= pages}
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                {L.next}
                <ChevronRight aria-hidden className="size-3.5" />
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
