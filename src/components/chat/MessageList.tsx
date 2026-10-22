"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { content } from "@/config/content";
import { defaultManager, type ManagerProfile } from "@/config/managers";
import { ManagerAvatar } from "./ManagerAvatar";
import { formatBytes, formatTime, type ChatMessage } from "@/lib/api";

export type ChatText = { [K in "systemLabel" | "youLabel" | "visitorLabel" | "adminLabel" | "sending" | "failed" | "retry"]: string };
export type LocalMessage = ChatMessage & { local?: "sending" | "failed" };

/** Shared message feed. `viewer` decides whose messages sit on the right. */
export function MessageList({
  messages,
  viewer,
  onRetry,
  emptyText,
  text = content.chat,
  locale = content.locale,
  appearance = "visitor",
  manager,
  actions,
}: {
  messages: LocalMessage[];
  viewer: "visitor" | "admin";
  onRetry?: (m: LocalMessage) => void;
  emptyText: string;
  /** Labels; the admin panel passes its own language. */
  text?: ChatText;
  locale?: string;
  appearance?: "visitor" | "admin";
  manager?: ManagerProfile | null;
  actions?: (message: ChatMessage) => ReactNode;
}) {
  const adm = appearance === "admin";
  const operator = manager ?? defaultManager;
  const end = useRef<HTMLLIElement>(null);
  const count = messages.length;
  const lastMessageId = messages.at(-1)?.id;
  const lastSequence = messages.at(-1)?.sequence;
  const previousSequence = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousSequence.current;
    previousSequence.current = lastSequence;
    if (previous && lastSequence && BigInt(lastSequence) <= BigInt(previous)) return;
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lastMessageId, lastSequence]);

  if (count === 0) return <p className={`px-1 py-10 text-center text-sm ${adm ? "text-adm-ink-3" : "text-slate"}`}>{emptyText}</p>;

  return (
    <ol className="space-y-4" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => {
        if (m.sender === "system") {
          if (!adm) {
            return (
              <li key={m.id} className="flex justify-start">
                <div className="pop relative max-w-[90%] overflow-hidden rounded-2xl rounded-bl-md border border-paint/25 bg-paint/[0.035] px-4 py-3.5 sm:max-w-[75%]">
                  <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-paint/75" />
                  <div className="mb-3 flex items-start gap-3">
                    <ManagerAvatar manager={operator} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-[13px] font-semibold tracking-[0.01em] text-ink">{operator.name}</p>
                        <time className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-soft" dateTime={m.createdAt}>
                          {formatTime(m.createdAt, locale)}
                        </time>
                      </div>
                      <p className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-paint/15 bg-paint/[0.08] px-1.5 py-0.5 text-[10px] font-medium leading-relaxed text-sky">
                        <Clock3 aria-hidden size={10} strokeWidth={1.7} className="shrink-0" />
                        {text.systemLabel}
                      </p>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-[1.75] text-ink/90 sm:text-[15px]">{m.body}</p>
                </div>
              </li>
            );
          }
          return (
            <li
              key={m.id}
              className="mx-auto max-w-md rounded-lg border border-dashed border-adm-line-strong bg-adm-subtle px-3.5 py-2.5 text-[13.5px]"
            >
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-adm-ink-2">
                {text.systemLabel}
                <time className="ml-auto font-normal text-adm-ink-3" dateTime={m.createdAt}>
                  {formatTime(m.createdAt, locale)}
                </time>
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </li>
          );
        }
        const mine = m.sender === viewer;
        const who = m.sender === "visitor" ? (viewer === "visitor" ? text.youLabel : text.visitorLabel) : operator.name;
        return (
          <li key={m.clientMessageId || m.id} className={`flex gap-2.5 ${mine ? "justify-end" : "justify-start"}`}>
            {!adm && !mine && m.sender === "admin" && <ManagerAvatar manager={operator} size={36} />}
            <div className={`max-w-[85%] sm:max-w-[75%] ${m.local === "sending" ? "opacity-70" : ""}`}>
              <div
                className={`${
                  adm
                    ? mine
                      ? "rounded-lg rounded-br-sm bg-adm-accent px-3.5 py-2 text-[13.5px] text-white"
                      : "rounded-lg rounded-bl-sm border border-adm-line bg-adm-subtle px-3.5 py-2 text-[13.5px]"
                    : mine
                      ? "rounded-2xl rounded-br-md bg-paint px-4 py-2.5 font-medium text-on-paint"
                      : "rounded-2xl rounded-bl-md border border-line-strong bg-white/[0.04] px-4 py-2.5"
                } ${m.local === "failed" ? "ring-2 ring-danger" : ""}`}
              >
                {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                {m.files.length > 0 && (
                  <ul className={`flex flex-wrap gap-2 ${m.body ? "mt-2" : ""}`}>
                    {m.files.map((f) =>
                      f.mime.startsWith("image/") ? (
                        <li key={f.id}>
                          <a href={f.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg">
                            {/* eslint-disable-next-line @next/next/no-img-element -- private file served via /api/files */}
                            <img src={f.url} alt={f.name} className="h-28 w-36 object-cover" loading="lazy" />
                          </a>
                        </li>
                      ) : (
                        <li key={f.id}>
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener"
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm underline-offset-2 hover:underline ${
                              mine ? "bg-black/15" : adm ? "bg-adm-surface" : "bg-white/5"
                            }`}
                          >
                            <span className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold ${adm ? (mine ? "bg-white/20 text-white" : "bg-adm-ink text-white") : "bg-paint text-on-paint"}`}>PDF</span>
                            <span className="max-w-48 truncate">{f.name}</span>
                            <span className="opacity-70">{formatBytes(f.size)}</span>
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
              <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${adm ? "text-adm-ink-3" : "text-slate"} ${mine ? "justify-end" : ""}`}>
                <span>{who}</span>
                {m.local === "sending" ? (
                  <span>{text.sending}</span>
                ) : m.local === "failed" ? (
                  <>
                    <span className="text-danger">{text.failed}</span>
                    {onRetry && (
                      <button type="button" className="font-semibold text-cyan underline" onClick={() => onRetry(m)}>
                        {text.retry}
                      </button>
                    )}
                  </>
                ) : (
                  <time dateTime={m.createdAt}>{formatTime(m.createdAt, locale)}</time>
                )}
                {adm && viewer === "admin" && m.sender === "admin" && !m.local && actions?.(m)}
              </div>
            </div>
          </li>
        );
      })}
      <li ref={end} aria-hidden />
    </ol>
  );
}
