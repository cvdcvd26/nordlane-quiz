"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { content, LEAD_STATUSES, type LeadStatus } from "@/config/content";
import { api, formatTime } from "@/lib/api";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatPhone, nationalDigits } from "@/lib/contact";

const displayPhone = (p: string) => formatPhone(nationalDigits(p));

type Item = { id: number; status: LeadStatus; createdAt: string; lastMessageAt: string | null; messageCount: number; answer: string | null; contactName: string | null; contactPhone: string | null };
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
  const searchParams = useSearchParams();
  const [filters, setFiltersRaw] = useState<Filters>(() => fromParams(new URLSearchParams(searchParams.toString())));
  const [query, setQuery] = useState(filters.q);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoadedKey(key));
    return () => {
      cancelled = true;
    };
  }, [key]);

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
        <h1 className="text-2xl font-semibold">{content.admin.list.title}</h1>
        {data && <span className="pb-1 text-sm text-slate">{content.admin.list.total(data.total)}</span>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="sr-only" htmlFor="q">
          {content.admin.list.search}
        </label>
        <input id="q" className="field" placeholder={content.admin.list.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="sr-only" htmlFor="status">
          {content.admin.list.status}
        </label>
        <select
          id="status"
          className="field sm:w-48"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
        >
          <option value="">{content.admin.list.allStatuses}</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {content.admin.statuses[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost bg-surface text-sm"
          onClick={() => setFilters((f) => ({ ...f, sort: f.sort === "desc" ? "asc" : "desc", page: 1 }))}
        >
          {filters.sort === "asc" ? content.admin.list.oldestFirst : content.admin.list.newestFirst}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-6 rounded-(--radius-field) bg-danger-soft p-4 text-danger">
          {error}
        </p>
      )}

      <div className={`mt-6 overflow-x-auto rounded-(--radius-tile) border-2 border-line bg-surface transition-opacity ${loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b-2 border-line text-slate">
            <tr>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.id}</th>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.created}</th>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.status}</th>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.answer}</th>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.contact}</th>
              <th className="px-4 py-3 font-medium">{content.admin.list.columns.lastMessage}</th>
              <th className="px-4 py-3 text-right font-medium">{content.admin.list.columns.messages}</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((l) => (
              <tr key={l.id} className="relative border-b border-line last:border-0 hover:bg-paper">
                <td className="px-4 py-3 font-semibold">
                  <Link href={`/admin/leads/${l.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    #{l.id}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{formatTime(l.createdAt)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={l.status} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{l.answer ? l.answer.split(",").map((x) => content.admin.answers[x] ?? x).join(" · ") : "—"}</td>
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
                <td className="px-4 py-3 whitespace-nowrap">{l.lastMessageAt ? formatTime(l.lastMessageAt) : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{l.messageCount}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate">
                  {filters.q || filters.status ? content.admin.list.noResults : content.admin.list.empty}
                </td>
              </tr>
            )}
            {!data && !error && (
              <tr>
                <td colSpan={7} className="p-4">
                  <div className="skeleton h-24 rounded-lg" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label={content.admin.list.pages}>
          <button
            type="button"
            className="btn btn-ghost h-10 min-h-0 bg-surface text-sm"
            disabled={data.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            {content.admin.list.prev}
          </button>
          <span className="text-sm text-slate">
            {content.admin.list.pageOf(data.page, pages)}
          </span>
          <button
            type="button"
            className="btn btn-ghost h-10 min-h-0 bg-surface text-sm"
            disabled={data.page >= pages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            {content.admin.list.next}
          </button>
        </nav>
      )}
    </div>
  );
}
