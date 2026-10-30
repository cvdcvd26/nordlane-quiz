"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MessagesSquare, X } from "lucide-react";
import { api } from "@/lib/api";
import { inboxCopy } from "@/config/admin-inbox";
import { workflowCopy } from "@/config/admin-workflow";
import { LEAD_STATUSES } from "@/config/content";
import { confirmAdminDraftNavigation } from "@/lib/admin-draft-guard";
import { ACTIVITY_EVENT } from "./ActivityNotifier";
import { useAdminI18n } from "./i18n";

type Queue = "all" | "submitted" | "needs_reply" | "unfinished";
type Result = { items: { id: number; contactName: string | null; lastVisitorMessage: string | null; needsReply: boolean; isActive: boolean; stage: string }[]; total: number; page: number; pageSize: number };

export default function LeadInboxSidebar({ selectedId }: { selectedId: string }) {
  const { lang, t, err: tErr } = useAdminI18n();
  const C = workflowCopy[lang];
  const I = inboxCopy[lang];
  const params = useSearchParams();
  const initialQueue = params.get("queue");
  const [queue, setQueue] = useState<Queue>(initialQueue === "submitted" || initialQueue === "needs_reply" || initialQueue === "unfinished" ? initialQueue : "all");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState(query);
  const [extra, setExtra] = useState(() => ({
    status: (LEAD_STATUSES as readonly string[]).includes(params.get("status") ?? "") ? params.get("status")! : "",
    stage: ["questions", "task"].includes(params.get("stage") ?? "") ? params.get("stage")! : "",
    inactiveMinutes: params.has("inactiveMinutes") ? Math.max(0, Math.min(10080, Number(params.get("inactiveMinutes")) || 0)) : 30,
    sort: params.get("sort") === "asc" ? "asc" : "desc",
  }));
  const [page, setPage] = useState(Math.max(1, Number(params.get("page")) || 1));
  const [result, setResult] = useState<Result | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const requestParams = new URLSearchParams({ queue, q: search, page: String(page), pageSize: "20" });
  if (extra.status) requestParams.set("status", extra.status);
  if (extra.sort === "asc") requestParams.set("sort", "asc");
  if (queue === "unfinished") {
    if (extra.stage) requestParams.set("stage", extra.stage);
    requestParams.set("inactiveMinutes", String(extra.inactiveMinutes));
  }
  const requestKey = requestParams.toString();

  useEffect(() => {
    if (query === search) return;
    const timer = setTimeout(() => { setSearch(query); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    let stopped = false;
    let running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const value = await api<Result>(`/api/admin/leads?${requestKey}`, { signal: controller.signal });
        if (stopped) return;
        const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
        if (page > lastPage) { setPage(lastPage); return; }
        setResult(value); setLoadedKey(requestKey); setError(null);
      } catch (cause) { if (!stopped) setError(tErr(cause)); }
      finally { running = false; }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 8000);
    const activity = () => void load();
    window.addEventListener(ACTIVITY_EVENT, activity);
    return () => { stopped = true; controller.abort(); clearInterval(timer); window.removeEventListener(ACTIVITY_EVENT, activity); };
  }, [requestKey, page, tErr, reload]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const resize = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  const content = (mobile: boolean) => <>
    <div className="border-b border-adm-line px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="adm-section-title flex items-center gap-2"><MessagesSquare className="size-4 text-adm-accent" aria-hidden />{C.dialogs}</h2>
        {mobile && <button className="adm-btn size-8 px-0" type="button" aria-label={C.close} onClick={() => dialog.current?.close()}><X className="size-4" aria-hidden /></button>}
      </div>
      <label className="sr-only" htmlFor={mobile ? "mobile-dialog-search" : "dialog-search"}>{C.search}</label>
      <input id={mobile ? "mobile-dialog-search" : "dialog-search"} className="adm-input w-full" type="search" maxLength={200} placeholder={C.search} value={query} onChange={event => setQuery(event.target.value)} />
      <label className="sr-only" htmlFor={mobile ? "mobile-dialog-queue" : "dialog-queue"}>{I.filter}</label>
      <select id={mobile ? "mobile-dialog-queue" : "dialog-queue"} className="adm-input mt-2 w-full" value={queue} onChange={event => { setQueue(event.target.value as Queue); setExtra(value => ({ ...value, stage: "", inactiveMinutes: 30 })); setPage(1); }}>
        <option value="all">{C.all}</option><option value="submitted">{C.submitted}</option><option value="needs_reply">{I.needsReply}</option><option value="unfinished">{C.unfinished}</option>
      </select>
    </div>
    {error && <div className="p-3"><p role="alert" className="text-[12px] text-adm-red">{error}</p><button type="button" className="adm-btn mt-2" onClick={() => setReload(value => value + 1)}>{C.retry}</button></div>}
    <nav className="max-h-[65vh] overflow-y-auto" aria-label={C.dialogs}>
      {loadedKey !== requestKey && !error && <p role="status" className="p-3 text-[13px] text-adm-ink-3">{C.loading}</p>}
      {loadedKey === requestKey && result?.items.map(item => <Link key={item.id} href={`/admin/leads/${item.id}?${requestKey}`} aria-current={String(item.id) === selectedId ? "page" : undefined}
        onClick={event => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (String(item.id) !== selectedId && !confirmAdminDraftNavigation(C.draftWarning, event)) { event.preventDefault(); return; }
          dialog.current?.close();
        }}
        className={`block border-b border-adm-line px-3 py-3 transition-colors hover:bg-adm-subtle ${String(item.id) === selectedId ? "border-l-2 border-l-adm-accent bg-adm-accent-soft" : ""}`}>
        <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{item.contactName ?? `#${item.id}`}</span>{item.needsReply && <span className="size-2 shrink-0 rounded-full bg-adm-amber" aria-label={I.needsReply} />}</div>
        <p className="mt-1 truncate text-[12px] text-adm-ink-3">{item.lastVisitorMessage || (item.stage === "questions" ? C.questions : item.stage === "task" ? C.task : t.ui.workflow.stageTitle)}</p>
        <p className="mt-1 text-[11px] text-adm-ink-3">#{item.id}{item.isActive ? ` · ${C.active}` : ""}</p>
      </Link>)}
      {loadedKey === requestKey && result?.items.length === 0 && <p className="p-3 text-[13px] text-adm-ink-3">{C.empty}</p>}
    </nav>
    {result && result.total > result.pageSize && <div className="flex items-center justify-between gap-2 border-t border-adm-line p-2">
      <button type="button" className="adm-btn adm-btn-sm" aria-label={C.previous} disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-4" aria-hidden /></button>
      <span className="text-[12px] text-adm-ink-3 tabular-nums">{page} / {Math.ceil(result.total / result.pageSize)}</span>
      <button type="button" className="adm-btn adm-btn-sm" aria-label={C.next} disabled={page >= Math.ceil(result.total / result.pageSize)} onClick={() => setPage(value => value + 1)}><ChevronRight className="size-4" aria-hidden /></button>
    </div>}
  </>;

  return <div className="self-start xl:sticky xl:top-6">
    <button type="button" className="adm-btn mb-3 xl:hidden" onClick={() => dialog.current?.showModal()}><MessagesSquare className="size-4" aria-hidden />{C.dialogs}</button>
    <aside className="adm-panel hidden xl:block">{content(false)}</aside>
    <dialog ref={dialog} aria-label={C.dialogs} className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-80 max-w-[90vw] border-0 bg-adm-surface p-0 text-adm-ink shadow-xl backdrop:bg-black/30">{content(true)}</dialog>
  </div>;
}
