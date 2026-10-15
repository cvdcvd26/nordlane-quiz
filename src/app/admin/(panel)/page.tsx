"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { api } from "@/lib/api";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { StageBadge } from "@/components/admin/StageBadge";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { useAdminI18n } from "@/components/admin/i18n";

const displayPhone = (p: string) => formatPhone(nationalDigits(p));

type Item = { id: number; status: LeadStatus; createdAt: string; lastMessageAt: string | null; messageCount: number; answer: string | null; contactName: string | null; contactPhone: string | null; stage: string };
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

export default function LeadsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-64 rounded-(--radius-tile)" aria-busy />}>
      <Leads />
    </Suspense>
  );
}

function Leads() {
  const { t, time, err: tErr } = useAdminI18n();
  const searchParams = useSearchParams();
  const [filters, setFiltersRaw] = useState<Filters>(() => fromParams(new URLSearchParams(searchParams.toString())));
  const [query, setQuery] = useState(filters.q);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const key = toParams(filters);
  const loading = loadedKey !== key;

  const setFilters = (fn: (f: Filters) => Filters) => setFiltersRaw((f) => fn(f));

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
      .finally(() => !cancelled && setLoadedKey(key));
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

  const deleteSelected = async () => {
    setDeleting(true);
    try {
      const { deleted } = await api<{ deleted: number }>("/api/admin/leads", { method: "DELETE", json: { ids: [...selected] } });
      setSelected(new Set());
      setConfirming(false);
      setFlash(t.ui.list.deleted(deleted));
      setTimeout(() => setFlash(null), 4000);
      setReload((n) => n + 1);
    } catch (e) {
      setError(tErr(e));
    } finally {
      setDeleting(false);
    }
  };

  // Debounced search.
  useEffect(() => {
    if (query === filters.q) return;
    const t = setTimeout(() => setFiltersRaw((f) => ({ ...f, q: query, page: 1 })), 350);
    return () => clearTimeout(t);
  }, [query, filters.q]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-2xl font-semibold">{t.ui.list.title}</h1>
        {data && <span className="pb-1 text-sm text-slate">{t.ui.list.total(data.total)}</span>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="sr-only" htmlFor="q">
          {t.ui.list.search}
        </label>
        <input id="q" className="field" placeholder={t.ui.list.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="sr-only" htmlFor="status">
          {t.ui.list.status}
        </label>
        <select
          id="status"
          className="field sm:w-48"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
        >
          <option value="">{t.ui.list.allStatuses}</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.ui.statuses[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          onClick={() => setFilters((f) => ({ ...f, sort: f.sort === "desc" ? "asc" : "desc", page: 1 }))}
        >
          {filters.sort === "asc" ? t.ui.list.oldestFirst : t.ui.list.newestFirst}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="glass pop mt-4 flex flex-wrap items-center gap-3 rounded-(--radius-field) px-4 py-3 text-sm">
          <span className="font-semibold">{t.ui.list.selected(selected.size)}</span>
          {confirming ? (
            <>
              <span className="text-ink-soft">{t.ui.list.confirmDeleteMany(selected.size)}</span>
              <div className="ml-auto flex gap-2">
                <button type="button" className="btn btn-ghost h-9 min-h-0 px-4 text-sm" onClick={() => setConfirming(false)} disabled={deleting}>
                  {t.ui.list.cancel}
                </button>
                <button
                  type="button"
                  className="btn h-9 min-h-0 bg-danger px-4 text-sm text-paper hover:brightness-110"
                  onClick={() => void deleteSelected()}
                  disabled={deleting}
                >
                  {deleting ? t.ui.lead.deleting : t.ui.list.confirmYes}
                </button>
              </div>
            </>
          ) : (
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn btn-ghost h-9 min-h-0 px-4 text-sm" onClick={() => setSelected(new Set())}>
                {t.ui.list.clearSelection}
              </button>
              <button
                type="button"
                className="btn h-9 min-h-0 border border-danger/60 px-4 text-sm text-danger hover:bg-danger-soft"
                onClick={() => setConfirming(true)}
              >
                {t.ui.list.deleteSelected}
              </button>
            </div>
          )}
        </div>
      )}
      {flash && (
        <p role="status" className="pop mt-4 text-sm text-cyan">
          {flash}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-(--radius-field) bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      <div className={`mt-6 overflow-x-auto rounded-(--radius-tile) glass transition-opacity ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-line text-slate">
            <tr>
              <th className="w-10 py-3 pl-4">
                <input
                  type="checkbox"
                  className="size-4 accent-[#168bff]"
                  aria-label={t.ui.list.selectAll}
                  checked={allOnPage}
                  onChange={toggleAll}
                  disabled={!pageIds.length}
                />
              </th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.id}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.created}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.status}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.stage}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.answer}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.contact}</th>
              <th className="px-4 py-3 font-medium">{t.ui.list.columns.lastMessage}</th>
              <th className="px-4 py-3 text-right font-medium">{t.ui.list.columns.messages}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id} className={`relative border-b border-line last:border-0 hover:bg-white/[0.03] ${selected.has(l.id) ? "bg-paint/[0.06]" : ""}`}>
                <td className="relative z-10 w-10 py-3 pl-4">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#168bff]"
                    aria-label={t.ui.list.selectOne(l.id)}
                    checked={selected.has(l.id)}
                    onChange={() => toggleOne(l.id)}
                  />
                </td>
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/admin/leads/${l.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    #{l.id}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{time(l.createdAt)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={l.status} />
                </td>
                <td className="px-4 py-3">
                  <StageBadge stage={l.stage} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{l.answer ? l.answer.split(",").map((x) => t.ui.answers[x] ?? x).join(" · ") : "—"}</td>
                <td className="px-4 py-3">
                  {l.contactName ? (
                    <>
                      <span className="block font-medium">{l.contactName}</span>
                      <span className="block text-xs whitespace-nowrap text-slate">{l.contactPhone ? displayPhone(l.contactPhone) : ""}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{l.lastMessageAt ? time(l.lastMessageAt) : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{l.messageCount}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate">
                  {filters.q || filters.status ? t.ui.list.noResults : t.ui.list.empty}
                </td>
              </tr>
            )}
            {!data && !error && (
              <tr>
                <td colSpan={9} className="p-4">
                  <div className="skeleton h-24 rounded-lg" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label={t.ui.list.pages}>
          <button
            type="button"
            className="btn btn-ghost h-10 min-h-0 text-sm"
            disabled={data.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            {t.ui.list.prev}
          </button>
          <span className="text-sm text-slate">
            {t.ui.list.pageOf(data.page, pages)}
          </span>
          <button
            type="button"
            className="btn btn-ghost h-10 min-h-0 text-sm"
            disabled={data.page >= pages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            {t.ui.list.next}
          </button>
        </nav>
      )}
    </div>
  );
}
