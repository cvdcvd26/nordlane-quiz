"use client";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Languages } from "lucide-react";
import { MessageList } from "@/components/chat/MessageList";
import { translationCopy, type IncomingTranslationResponse, type TranslationStatus } from "@/config/chat-translation";
import { api, type ChatMessage } from "@/lib/api";
import { useAdminI18n } from "./i18n";

type Props = Omit<ComponentProps<typeof MessageList>, "viewer" | "appearance" | "messageExtension"> & { leadId: string };
type Entry = { body: string; sourceHash: string } | { error: string };
type Source = { id: string; key: string };
const budgetFailure = (code: string) => /limit|budget|credit/iu.test(code);
const terminalFailure = (code: string) => /limit|budget|credit|not_configured/iu.test(code);

const fingerprint = (leadId: string, message: ChatMessage) => JSON.stringify([
  leadId, message.id, message.body, message.bodyRich ?? null, message.changeRevision ?? 0,
]);

/** Translations are a separate admin request and never delay receipt of a chat message. */
export function AdminTranslatedMessageList({ leadId, messages, ...props }: Props) {
  const { lang } = useAdminI18n();
  const T = translationCopy[lang];
  const [statusState, setStatusState] = useState<{ leadId: string; value: TranslationStatus | null; failed: boolean } | null>(null);
  const [statusReload, setStatusReload] = useState(0);
  const [retry, setRetry] = useState(0);
  const [, redraw] = useState(0);
  const entries = useRef(new Map<string, Entry>());
  const inFlight = useRef(new Map<string, AbortController>());
  const controllers = useRef(new Set<AbortController>());
  const currentSources = useRef(new Set<string>());
  const status = statusState?.leadId === leadId ? statusState : null;
  // Polling replaces message objects. Only changed source content starts translation work.
  const sourceSignature = JSON.stringify(messages.filter(message => message.sender === "visitor" && message.body.trim() && !message.local)
    .map(message => ({ id: message.id, key: fingerprint(leadId, message) })));
  const sources = useMemo(() => JSON.parse(sourceSignature) as Source[], [sourceSignature]);

  useEffect(() => {
    currentSources.current = new Set(sources.map(source => source.key));
  }, [sources]);
  useEffect(() => () => {
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    inFlight.current.clear();
  }, [leadId]);

  useEffect(() => {
    const controller = new AbortController();
    api<TranslationStatus>("/api/admin/translation", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setStatusState({ leadId, value, failed: false });
    }).catch(() => {
      if (!controller.signal.aborted) setStatusState({ leadId, value: null, failed: true });
    });
    return () => controller.abort();
  }, [leadId, statusReload]);

  const cacheOnly = status?.value?.reason === "limit_reached";
  const enabled = Boolean(status?.value?.enabled || cacheOnly);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const pending = sources.filter(source => !entries.current.has(source.key) && !inFlight.current.has(source.key));
    if (!pending.length) return;
    pending.forEach(source => inFlight.current.set(source.key, controller));
    controllers.current.add(controller);
    const run = async () => {
      let readCacheOnly = cacheOnly;
      try {
        for (let index = 0; index < pending.length && !controller.signal.aborted; index += 20) {
          const batch = pending.slice(index, index + 20).filter(source => currentSources.current.has(source.key));
          if (!batch.length) continue;
          let stopped: string | null = null;
          try {
            const result = await api<IncomingTranslationResponse>(`/api/admin/leads/${leadId}/translations`, {
              method: "POST", signal: controller.signal, json: { kind: "incoming", messageIds: batch.map(source => source.id), ...(readCacheOnly ? { cacheOnly: true } : {}) },
            });
            if (controller.signal.aborted) return;
            for (const source of batch) {
              if (!currentSources.current.has(source.key)) continue;
              const translated = result.translations.find(item => item.messageId === source.id);
              const failed = result.failures.find(item => item.messageId === source.id);
              entries.current.set(source.key, translated
                ? { body: translated.body, sourceHash: translated.sourceHash }
                : { error: failed?.code ?? "translation_failed" });
              if (!translated && failed && terminalFailure(failed.code) && (!stopped || !budgetFailure(failed.code))) stopped = failed.code;
            }
          } catch (error) {
            if (controller.signal.aborted) return;
            const code = error && typeof error === "object" && "code" in error ? String(error.code) : "translation_failed";
            for (const source of batch) if (currentSources.current.has(source.key)) entries.current.set(source.key, { error: code });
            if (terminalFailure(code)) stopped = code;
          }
          const stopHistory = stopped && !budgetFailure(stopped);
          if (stopped && budgetFailure(stopped)) {
            // The cap may be reached after status was loaded. Later history
            // can still contain paid-for translations; only read their cache.
            readCacheOnly = true;
            setStatusState(current => current?.leadId === leadId && current.value && current.value.reason !== "limit_reached"
              ? { ...current, value: { ...current.value, enabled: false, reason: "limit_reached" } }
              : current);
          }
          if (stopped && stopHistory) for (const source of pending.slice(index + 20)) if (currentSources.current.has(source.key)) entries.current.set(source.key, { error: stopped });
          if (!controller.signal.aborted) redraw(value => value + 1);
          if (stopHistory) return;
        }
      } finally {
        pending.forEach(source => { if (inFlight.current.get(source.key) === controller) inFlight.current.delete(source.key); });
        controllers.current.delete(controller);
      }
    };
    void run();
    // New chat messages must not abort and restart paid requests for earlier messages.
    // The lead/unmount cleanup above owns cancellation; source keys reject stale results.
  }, [enabled, cacheOnly, leadId, sources, retry]);

  const retryMessage = (message: ChatMessage) => {
    entries.current.delete(fingerprint(leadId, message));
    setRetry(value => value + 1);
  };
  const errorLabel = (code: string) => /limit|budget|credit/iu.test(code) ? T.incomingLimit : /not_configured|unavailable/iu.test(code) ? T.incomingUnavailable : T.incomingFailed;
  const extension = (message: ChatMessage) => {
    if (!enabled) return null;
    const entry = entries.current.get(fingerprint(leadId, message));
    return <div className="mt-2 rounded-lg border border-adm-line bg-adm-surface px-3 py-2.5 text-[12.5px]" data-admin-translation>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-adm-accent"><Languages aria-hidden className="size-3.5" />{T.incomingTitle}</p>
      {entry && "body" in entry
        ? <p lang="ru" className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-adm-ink-2 [overflow-wrap:anywhere]">{entry.body}</p>
        : <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-adm-ink-3">
          <span role="status">{entry && "error" in entry ? errorLabel(entry.error) : T.incomingLoading}</span>
          {entry && "error" in entry && <button type="button" className="font-medium text-adm-accent underline underline-offset-2" onClick={() => retryMessage(message)}>{T.incomingRetry}</button>}
        </div>}
    </div>;
  };

  return <>
    {sources.length > 0 && status?.failed && <p role="status" className="adm-help mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{T.incomingUnavailable}</span><button type="button" className="text-adm-accent underline" onClick={() => setStatusReload(value => value + 1)}>{T.incomingRetry}</button>
    </p>}
    {sources.length > 0 && status?.value?.reason === "limit_reached" && <p role="status" className="adm-help mb-3">{T.incomingLimit}</p>}
    <MessageList {...props} messages={messages} viewer="admin" appearance="admin" messageExtension={extension} />
  </>;
}
