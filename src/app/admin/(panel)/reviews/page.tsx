"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { LeadStatus } from "@/config/content";
import { api } from "@/lib/api";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { EmptyState, ErrorState, PageHeader, StatusBadge } from "@/components/admin/ui";
import { useAdminI18n } from "@/components/admin/i18n";

type Review = { id: string; review: string; submittedAt: string; leadId: number; status: LeadStatus; name: string | null; phone: string | null };
type ReviewsResponse = { items: Review[]; total: number; page: number; pageSize: number };

const LONG = 280;

export default function ReviewsPage() {
  const { t, time, err: tErr } = useAdminI18n();
  const R = t.ui.reviews;
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReviewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set("q", q);
    api<ReviewsResponse>(`/api/admin/reviews?${params}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(tErr(e)));
    return () => {
      cancelled = true;
    };
  }, [q, page, reload, tErr]);

  useEffect(() => {
    const onActivity = () => setReload((n) => n + 1);
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, onActivity);
  }, []);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;

  return (
    <div>
      <PageHeader title={R.title} meta={data ? R.total(data.total) : undefined} description={R.description} />

      <div className="adm-panel">
        <div className="flex min-h-12 items-center gap-2 border-b border-adm-line px-3 py-2">
          <div className="relative w-full sm:max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-adm-ink-3" />
            <label className="sr-only" htmlFor="rq">
              {t.ui.list.search}
            </label>
            <input id="rq" type="search" className="adm-input pl-8" placeholder={R.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        {error && (
          <div className="p-3">
            <ErrorState text={error} onRetry={() => setReload((n) => n + 1)} />
          </div>
        )}

        {!data && !error && (
          <ul aria-busy aria-label={t.ui.common.loading}>
            {[0, 1, 2].map((i) => (
              <li key={i} className="space-y-2 border-b border-adm-line p-4 last:border-0">
                <div className="adm-skeleton h-3.5 w-40" />
                <div className="adm-skeleton h-3.5 w-full" />
                <div className="adm-skeleton h-3.5 w-2/3" />
              </li>
            ))}
          </ul>
        )}

        {data && data.items.length === 0 && <EmptyState text={q ? R.noResults : R.empty} />}

        {data && data.items.length > 0 && (
          <ul>
            {data.items.map((r) => {
              const long = r.review.length > LONG;
              const expanded = open.has(r.id);
              return (
                <li key={r.id} className="grid gap-x-6 gap-y-2 border-b border-adm-line px-4 py-4 last:border-0 md:grid-cols-[200px_1fr_auto]">
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-semibold tracking-wide text-adm-ink-3 uppercase md:sr-only">{R.employee}</p>
                    <p className="truncate font-semibold">{r.name ?? "—"}</p>
                    {r.phone && <p className="text-[12.5px] text-adm-ink-3 tabular-nums">{formatPhone(nationalDigits(r.phone))}</p>}
                    <time className="mt-1 block text-[12.5px] text-adm-ink-3 tabular-nums" dateTime={r.submittedAt}>
                      {time(r.submittedAt)}
                    </time>
                  </div>
                  <div className="min-w-0">
                    <p className="sr-only">{R.review}</p>
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{long && !expanded ? `${r.review.slice(0, LONG).trimEnd()}…` : r.review}</p>
                    {long && (
                      <button type="button" className="mt-1 text-[13px] font-semibold text-adm-accent hover:underline" aria-expanded={expanded} onClick={() => toggle(r.id)}>
                        {expanded ? R.showLess : R.showMore}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-3 md:flex-col md:items-end">
                    <StatusBadge status={r.status} />
                    <Link href={`/admin/leads/${r.leadId}`} className="text-[13px] font-semibold text-adm-accent hover:underline" aria-label={R.openLead(r.leadId)}>
                      {R.lead} #{r.leadId} →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {data && data.total > 0 && (
          <nav className="flex items-center gap-3 border-t border-adm-line px-3 py-2" aria-label={t.ui.list.pages}>
            <span className="text-[13px] text-adm-ink-3 tabular-nums">{t.ui.list.range(from, to, data.total)}</span>
            <div className="ml-auto flex gap-1.5">
              <button type="button" className="adm-btn adm-btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft aria-hidden className="size-3.5" />
                {t.ui.list.prev}
              </button>
              <button type="button" className="adm-btn adm-btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t.ui.list.next}
                <ChevronRight aria-hidden className="size-3.5" />
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
