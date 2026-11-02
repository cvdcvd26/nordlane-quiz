"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { translationCopy, type IncomingTranslationResponse, type TranslationStatus } from "@/config/chat-translation";
import { api, ApiError } from "@/lib/api";
import { waitForCachedTranslation } from "@/lib/admin-translation-cache";
import { useAdminI18n } from "./i18n";

type Translation = { body: string; sourceHash: string };
type Source = { kind: "task_review" | "incoming"; leadId: string | number; sourceId: string };
type Request = (source: Source, signal: AbortSignal, retry: boolean) => Promise<Translation | null>;
type Entry = { key: string; value: Translation | null } | { key: string; error: string };
const TranslationContext = createContext<Request | null>(null);
const budgetFailure = (code: string) => /limit|budget|credit/iu.test(code);
const failureCode = (error: unknown) => error instanceof ApiError && error.code ? error.code : "translation_failed";

/** One availability check and a bounded queue per mounted admin screen, never a global content cache. */
function createTranslationQueue(): Request {
  let statusPromise: Promise<TranslationStatus> | null = null;
  let cacheOnly = false;
  let unavailable = false;
  let running = false;
  const queue: (() => Promise<void>)[] = [];
  const next = () => {
    if (running || !queue.length) return;
    running = true;
    void queue.shift()!().finally(() => { running = false; next(); });
  };
  return (source, signal, retry) => new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        signal.throwIfAborted();
        if (retry) { statusPromise = null; unavailable = false; }
        statusPromise ??= api<TranslationStatus>("/api/admin/translation");
        const status = await statusPromise;
        signal.throwIfAborted();
        if (retry) cacheOnly = status.reason === "limit_reached";
        if (unavailable || (!status.enabled && status.reason !== "limit_reached")) { resolve(null); return; }
        cacheOnly ||= status.reason === "limit_reached";
        const common = { method: "POST", signal };
        const url = `/api/admin/leads/${source.leadId}/translations`;
        const load = async (readCacheOnly: boolean): Promise<Translation> => {
          if (source.kind === "task_review") return api<Translation>(url, { ...common, json: { kind: source.kind, submissionId: source.sourceId, ...(readCacheOnly ? { cacheOnly: true } : {}) } });
          const result = await api<IncomingTranslationResponse>(url, { ...common, json: { kind: "incoming", messageIds: [source.sourceId], ...(readCacheOnly ? { cacheOnly: true } : {}) } });
          signal.throwIfAborted();
          const translated = result.translations.find(item => item.messageId === source.sourceId);
          if (!translated) throw new ApiError("Could not translate task response", 503, result.failures.find(item => item.messageId === source.sourceId)?.code ?? "translation_failed");
          return translated;
        };
        let result: Translation;
        try { result = await load(cacheOnly); }
        catch (error) {
          if (failureCode(error) !== "translation_busy" || signal.aborted) throw error;
          const cached = await waitForCachedTranslation(() => load(true), signal);
          if (!cached) throw error;
          result = cached;
        }
        signal.throwIfAborted();
        resolve(result);
      } catch (error) {
        if (!signal.aborted) {
          const code = failureCode(error);
          if (budgetFailure(code)) cacheOnly = true;
          if (code === "translation_not_configured") unavailable = true;
        }
        reject(error);
      }
    });
    next();
  });
}

export function AdminTaskTranslationProvider({ children }: { children: ReactNode }) {
  const [request] = useState(createTranslationQueue);
  return <TranslationContext value={request}>{children}</TranslationContext>;
}

/** The original remains in the parent. Only authenticated admin screens mount this translation. */
export function AdminTaskTranslation({ leadId, sourceId, kind = "task_review", body }: Omit<Source, "kind"> & { kind?: Source["kind"]; body: string }) {
  const request = useContext(TranslationContext);
  const { lang } = useAdminI18n();
  const T = translationCopy[lang];
  const [entry, setEntry] = useState<Entry | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify([leadId, kind, sourceId, body]);
  const hasText = Boolean(body.trim());

  useEffect(() => {
    if (!request || !hasText) return;
    const controller = new AbortController();
    void request({ leadId, sourceId, kind }, controller.signal, retry > 0)
      .then(value => { if (!controller.signal.aborted) setEntry({ key, value }); })
      .catch(error => { if (!controller.signal.aborted) setEntry({ key, error: failureCode(error) }); });
    return () => controller.abort();
  }, [request, key, leadId, sourceId, kind, hasText, retry]);

  if (!request || !hasText) return null;
  const current = entry?.key === key ? entry : null;
  if (current && "value" in current && current.value === null) return null;
  const value = current && "value" in current ? current.value : null;
  const error = current && "error" in current ? current.error : null;
  const errorLabel = error && (budgetFailure(error) ? T.incomingLimit : /not_configured|unavailable/iu.test(error) ? T.incomingUnavailable : T.incomingFailed);
  return <div className="mt-3 rounded-lg border border-adm-line bg-adm-surface px-3 py-2.5 text-[12.5px]" data-admin-task-translation>
    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-adm-accent"><Languages aria-hidden className="size-3.5" />{T.incomingTitle}</p>
    {value
      ? <p lang="ru" className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-adm-ink-2 [overflow-wrap:anywhere]">{value.body}</p>
      : <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-adm-ink-3">
        <span role="status">{errorLabel || T.incomingLoading}</span>
        {error && <button type="button" className="font-medium text-adm-accent underline underline-offset-2" onClick={() => setRetry(value => value + 1)}>{T.incomingRetry}</button>}
      </div>}
  </div>;
}
