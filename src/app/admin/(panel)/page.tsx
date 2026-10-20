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

const displayPhone = (p: string) => formatPhone(nationalDigits(p));

type Item = {
  manager: ManagerProfile;
  id: number;
  status: LeadStatus;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  answer: string | null;
  contactName: string | null;
  contactPhone: string | null;
  stage: string;
  answered: number;
};
type ListResponse = { items: Item[]; total: number; page: number; pageSize: number };
type Filters = { q: string; status: string; sort: "desc" | "asc"; page: number };

const fromParams = (p: URLSearchParams): Filters => ({
  q: p.get("q") ?? "",
  status: p.get("status") ?? "",
  sort: p.get("sort") === "asc" ? "asc" : "desc",
  page: Number(p.get("page")) || 1,
});

const toParams = (f: Filters) => {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.status) params.set("status", f.status);
  if (f.sort !== "desc") params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
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
  const { t, time, err: tErr } = useAdminI18n();
  const L = t.ui.list;
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
  const key = toParams(filters);
  const loading = loadedKey !== `${key}#${reload}`;

  useEffect(() => {
    window.history.replaceState(null, "", `/admin${key ? `?${key}` : ""}`);
    let cancelled = false;
    api<ListResponse>(`/api/admin/leads?${key}`)
      .then((d) => {
        if (cancelled) return;
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
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, onActivity);
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
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters["sort"], page: 1 }))}
              >
                <option value="desc">{L.newestFirst}</option>
                <option value="asc">{L.oldestFirst}</option>
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
                <th>{L.columns.lastMessage}</th>
                <th className="text-right">{L.columns.messages}</th>
                <th>{L.columns.created}</th>
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
                    <Link href={`/admin/leads/${l.id}`} className="font-semibold after:absolute after:inset-0 hover:text-adm-accent">
                      {l.contactName ?? "—"}
                    </Link>
                    <span className="block text-[12.5px] whitespace-nowrap text-adm-ink-3 tabular-nums">
                      #{l.id}
                      {l.contactPhone ? ` · ${displayPhone(l.contactPhone)}` : ""}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-adm-accent">{l.manager.name}</span>
                  </td>
                  <td>
                    <StageTrack stage={l.stage} answered={l.answered} total={QUESTION_KEYS.length} />
                  </td>
                  <td className="relative z-10">
                    <StatusSelect value={l.status} label={L.statusFor(l.id)} disabled={saving === l.id} onChange={(s) => void changeStatus(l.id, s)} />
                  </td>
                  <td className="whitespace-nowrap text-adm-ink-2">{l.answer ? l.answer.split(",").map((x) => t.ui.answers[x] ?? x).join(" · ") : "—"}</td>
                  <td className="whitespace-nowrap text-adm-ink-2 tabular-nums">{l.lastMessageAt ? time(l.lastMessageAt) : "—"}</td>
                  <td className="text-right text-adm-ink-2 tabular-nums">{l.messageCount}</td>
                  <td className="whitespace-nowrap text-adm-ink-2 tabular-nums">{time(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.items.length === 0 && <EmptyState text={filters.q || filters.status ? L.noResults : L.empty} />}
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
