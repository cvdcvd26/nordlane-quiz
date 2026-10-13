"use client";
import { useEffect, useRef } from "react";
import { content } from "@/config/content";
import { formatBytes, formatTime, type ChatMessage } from "@/lib/api";

export type LocalMessage = ChatMessage & { local?: "sending" | "failed" };

/** Shared message feed. `viewer` decides whose messages sit on the right. */
export function MessageList({
  messages,
  viewer,
  onRetry,
  emptyText,
}: {
  messages: LocalMessage[];
  viewer: "visitor" | "admin";
  onRetry?: (m: LocalMessage) => void;
  emptyText: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  if (count === 0) return <p className="px-1 py-10 text-center text-sm text-slate">{emptyText}</p>;

  return (
    <ol className="space-y-4" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => {
        if (m.sender === "system") {
          return (
            <li key={m.id} className="pop mx-auto max-w-md rounded-(--radius-field) border border-paint/40 bg-paint-soft px-4 py-3 text-sm shadow-[0_0_30px_-12px_#3ee8b0]">
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-paint">
                <span aria-hidden className="chip-dot" />
                {content.chat.systemLabel}
                <time className="ml-auto font-normal text-slate" dateTime={m.createdAt}>
                  {formatTime(m.createdAt)}
                </time>
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </li>
          );
        }
        const mine = m.sender === viewer;
        const who = m.sender === "visitor" ? (viewer === "visitor" ? content.chat.youLabel : content.chat.visitorLabel) : content.chat.adminLabel;
        return (
          <li key={m.clientMessageId || m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] sm:max-w-[75%] ${m.local === "sending" ? "opacity-70" : ""}`}>
              <div
                className={`rounded-2xl px-4 py-2.5 ${
                  mine ? "rounded-br-md bg-paint font-medium text-on-paint shadow-[0_8px_24px_-12px_#3ee8b0]" : "rounded-bl-md border border-line-strong bg-white/[0.04]"
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
                              mine ? "bg-black/15" : "bg-white/5"
                            }`}
                          >
                            <span className="rounded bg-paint px-1.5 py-0.5 text-[0.65rem] font-bold text-on-paint">PDF</span>
                            <span className="max-w-48 truncate">{f.name}</span>
                            <span className="opacity-70">{formatBytes(f.size)}</span>
                          </a>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
              <p className={`mt-1 flex gap-2 text-xs text-slate ${mine ? "justify-end" : ""}`}>
                <span>{who}</span>
                {m.local === "sending" ? (
                  <span>{content.chat.sending}</span>
                ) : m.local === "failed" ? (
                  <>
                    <span className="text-danger">{content.chat.failed}</span>
                    {onRetry && (
                      <button type="button" className="font-semibold text-paint underline" onClick={() => onRetry(m)}>
                        {content.chat.retry}
                      </button>
                    )}
                  </>
                ) : (
                  <time dateTime={m.createdAt}>{formatTime(m.createdAt)}</time>
                )}
              </p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
