"use client";
import { useEffect, useRef } from "react";
import { content } from "@/config/content";
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
}: {
  messages: LocalMessage[];
  viewer: "visitor" | "admin";
  onRetry?: (m: LocalMessage) => void;
  emptyText: string;
  /** Labels; the admin panel passes its own language. */
  text?: ChatText;
  locale?: string;
  appearance?: "visitor" | "admin";
}) {
  const adm = appearance === "admin";
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);

  if (count === 0) return <p className={`px-1 py-10 text-center text-sm ${adm ? "text-adm-ink-3" : "text-slate"}`}>{emptyText}</p>;

  return (
    <ol className="space-y-4" aria-live="polite" aria-relevant="additions">
      {messages.map((m) => {
        if (m.sender === "system") {
          return (
            <li
              key={m.id}
              className={
                adm
                  ? "mx-auto max-w-md rounded-lg border border-dashed border-adm-line-strong bg-adm-subtle px-3.5 py-2.5 text-[13.5px]"
                  : "pop mx-auto max-w-md rounded-(--radius-field) border border-paint/40 bg-paint-soft px-4 py-3 text-sm shadow-[0_0_30px_-12px_#00d9ff]"
              }
            >
              <p className={`mb-1 flex items-center gap-2 text-xs font-semibold ${adm ? "text-adm-ink-2" : "text-cyan"}`}>
                {!adm && <span aria-hidden className="chip-dot" />}
                {text.systemLabel}
                <time className={`ml-auto font-normal ${adm ? "text-adm-ink-3" : "text-slate"}`} dateTime={m.createdAt}>
                  {formatTime(m.createdAt, locale)}
                </time>
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </li>
          );
        }
        const mine = m.sender === viewer;
        const who = m.sender === "visitor" ? (viewer === "visitor" ? text.youLabel : text.visitorLabel) : text.adminLabel;
        return (
          <li key={m.clientMessageId || m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] sm:max-w-[75%] ${m.local === "sending" ? "opacity-70" : ""}`}>
              <div
                className={`${
                  adm
                    ? mine
                      ? "rounded-lg rounded-br-sm bg-adm-accent px-3.5 py-2 text-[13.5px] text-white"
                      : "rounded-lg rounded-bl-sm border border-adm-line bg-adm-subtle px-3.5 py-2 text-[13.5px]"
                    : mine
                      ? "rounded-2xl rounded-br-md bg-paint px-4 py-2.5 font-medium text-on-paint shadow-[0_8px_24px_-12px_#00d9ff]"
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
              <p className={`mt-1 flex gap-2 text-xs ${adm ? "text-adm-ink-3" : "text-slate"} ${mine ? "justify-end" : ""}`}>
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
              </p>
            </div>
          </li>
        );
      })}
      <div ref={end} />
    </ol>
  );
}
