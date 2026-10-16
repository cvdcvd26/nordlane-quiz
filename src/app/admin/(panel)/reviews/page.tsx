"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { LeadStatus } from "@/config/content";
import { api } from "@/lib/api";
import { formatPhone, nationalDigits } from "@/lib/contact";
import { ACTIVITY_EVENT } from "@/components/admin/ActivityNotifier";
import { AdmStars, EmptyState, ErrorState, PageHeader, StatusBadge, TestimonialBadge, type TestimonialStatus } from "@/components/admin/ui";
import { toast } from "@/components/admin/toast";
import { useAdminI18n } from "@/components/admin/i18n";

type Review = { id: string; review: string; submittedAt: string; leadId: number; status: LeadStatus; name: string | null; phone: string | null };
type ReviewsResponse = { items: Review[]; total: number; page: number; pageSize: number };

const LONG = 280;

export default function ReviewsPage() {
  return (
    <Suspense fallback={<div className="adm-skeleton h-64" aria-busy />}>
      <Reviews />
    </Suspense>
  );
}

/** Two kinds of reviews: written with the task (internal) and public site reviews (moderated). */
function Reviews() {
  const { t } = useAdminI18n();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = params.get("tab") === "site" ? "site" : "task";
  const tabs = [
    { key: "task", label: t.ui.testimonials.tabTask },
    { key: "site", label: t.ui.testimonials.tabSite },
  ] as const;
  return (
    <div>
      <PageHeader
        title={t.ui.reviews.title}
        description={tab === "site" ? t.ui.testimonials.siteDescription : t.ui.reviews.description}
      />
      <div role="tablist" aria-label={t.ui.reviews.title} className="mb-4 flex gap-1 border-b border-adm-line">
        {tabs.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => router.replace(x.key === "site" ? `${path}?tab=site` : path)}
            className={`-mb-px border-b-2 px-3 pb-2.5 text-[13.5px] font-semibold transition-colors ${
              tab === x.key ? "border-adm-accent text-adm-ink" : "border-transparent text-adm-ink-3 hover:text-adm-ink"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === "site" ? <SiteReviews /> : <TaskReviews />}
    </div>
  );
}

function TaskReviews() {
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

type SiteReview = {
  id: string;
  name: string;
  rating: number;
  body: string;
  status: TestimonialStatus;
  createdAt: string;
  publishedAt: string | null;
  leadId: number | null;
};
type SiteResponse = { items: SiteReview[]; counts: Record<TestimonialStatus, number>; total: number; page: number; pageSize: number };

function SiteReviews() {
  const { t, time, err: tErr } = useAdminI18n();
  const M = t.ui.testimonials;
  const [status, setStatus] = useState<TestimonialStatus | "">("pending");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ page: String(page) });
    if (status) q.set("status", status);
    api<SiteResponse>(`/api/admin/testimonials?${q}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(tErr(e)));
    return () => {
      cancelled = true;
    };
  }, [status, page, reload, tErr]);

  useEffect(() => {
    const onActivity = () => setReload((n) => n + 1);
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, onActivity);
  }, []);

  const act = async (id: string, next: TestimonialStatus | "delete") => {
    setBusy(id);
    try {
      if (next === "delete") {
        await api(`/api/admin/testimonials/${id}`, { method: "DELETE" });
        toast({ kind: "success", title: M.deleted });
      } else {
        await api(`/api/admin/testimonials/${id}`, { method: "PATCH", json: { status: next } });
        toast({ kind: "success", title: M.changed(M.statuses[next]) });
      }
      setConfirm(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast({ kind: "error", title: tErr(e) });
    } finally {
      setBusy(null);
    }
  };

  const filters: (TestimonialStatus | "")[] = ["pending", "published", "rejected", ""];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.pageSize) : 0;
  const allCount = data ? data.counts.pending + data.counts.published + data.counts.rejected : 0;

  return (
    <div className="adm-panel">
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-b border-adm-line px-3 py-2" role="group" aria-label={t.ui.list.status}>
        {filters.map((f) => (
          <button
            key={f || "all"}
            type="button"
            aria-pressed={status === f}
            onClick={() => {
              setStatus(f);
              setPage(1);
            }}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors ${
              status === f ? "bg-adm-ink text-white" : "text-adm-ink-2 hover:bg-adm-subtle hover:text-adm-ink"
            }`}
          >
            {f ? M.statuses[f] : M.all}
            {data && <span className="tabular-nums opacity-70">{f ? data.counts[f] : allCount}</span>}
          </button>
        ))}
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
            </li>
          ))}
        </ul>
      )}
      {data && data.items.length === 0 && <EmptyState text={allCount ? M.emptyStatus : M.empty} />}

      {data && data.items.length > 0 && (
        <ul>
          {data.items.map((r) => (
            <li key={r.id} className="grid gap-x-6 gap-y-2 border-b border-adm-line px-4 py-4 last:border-0 md:grid-cols-[200px_1fr_auto]">
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <AdmStars value={r.rating} />
                <time className="mt-1 block text-[12.5px] text-adm-ink-3 tabular-nums" dateTime={r.createdAt}>
                  {time(r.createdAt)}
                </time>
              </div>
              <div className="min-w-0">
                <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{r.body}</p>
                {r.leadId && (
                  <Link href={`/admin/leads/${r.leadId}`} className="mt-1 inline-block text-[13px] font-semibold text-adm-accent hover:underline">
                    {t.ui.reviews.lead} #{r.leadId} →
                  </Link>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 md:flex-col md:items-end">
                <TestimonialBadge status={r.status} />
                {confirm === r.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] text-adm-red">{M.confirmDelete}</span>
                    <button type="button" className="adm-btn adm-btn-sm" onClick={() => setConfirm(null)}>
                      {t.ui.list.cancel}
                    </button>
                    <button type="button" className="adm-btn adm-btn-danger-solid adm-btn-sm" disabled={busy === r.id} onClick={() => void act(r.id, "delete")}>
                      {t.ui.list.confirmYes}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    {r.status !== "published" && (
                      <button type="button" className="adm-btn adm-btn-primary adm-btn-sm" disabled={busy === r.id} onClick={() => void act(r.id, "published")}>
                        {M.publish}
                      </button>
                    )}
                    {r.status === "published" && (
                      <button type="button" className="adm-btn adm-btn-sm" disabled={busy === r.id} onClick={() => void act(r.id, "pending")}>
                        {M.unpublish}
                      </button>
                    )}
                    {r.status === "pending" && (
                      <button type="button" className="adm-btn adm-btn-danger adm-btn-sm" disabled={busy === r.id} onClick={() => void act(r.id, "rejected")}>
                        {M.reject}
                      </button>
                    )}
                    <button type="button" className="adm-btn adm-btn-quiet adm-btn-sm" onClick={() => setConfirm(r.id)}>
                      {M.delete}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
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
  );
}
