"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { content } from "@/config/content";
import { chatConfig, uploadConfig } from "@/config/settings";
import { api, newId, type ChatMessage, type PublicFile } from "@/lib/api";
import { MessageList, type LocalMessage } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { SoundToggle } from "../ui/SoundToggle";
import { playChime } from "@/lib/sound";

type ChatResponse = { messages: ChatMessage[]; attachmentsEnabled: boolean };

/**
 * Built-in chat. New messages arrive by polling every few seconds (paused while the tab is hidden).
 * Sending is idempotent: a retry after a network error reuses the same clientMessageId.
 */
export function VisitorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<LocalMessage[]>([]);
  const [attachments, setAttachments] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const last = useRef<string | undefined>(undefined);
  // Ids already shown; the chime plays only for admin/system messages that arrive after the first load.
  const known = useRef<Set<string> | null>(null);
  const soundOn = useRef(true);

  const notify = useCallback((incoming: ChatMessage[]) => {
    if (known.current === null) {
      known.current = new Set(incoming.map((m) => m.id));
      return;
    }
    const fresh = incoming.filter((m) => !known.current!.has(m.id));
    fresh.forEach((m) => known.current!.add(m.id));
    if (soundOn.current && fresh.some((m) => m.sender !== "visitor")) playChime("message");
  }, []);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      incoming.forEach((m) => byId.set(m.id, m));
      const list = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      last.current = list.at(-1)?.createdAt;
      return list;
    });
    const ids = new Set(incoming.map((m) => m.clientMessageId));
    setPending((p) => p.filter((m) => !ids.has(m.clientMessageId)));
  }, []);

  const poll = useCallback(async () => {
    try {
      const q = last.current ? `?after=${encodeURIComponent(last.current)}` : "";
      const res = await api<ChatResponse>(`/api/chat${q}`);
      notify(res.messages);
      merge(res.messages);
      setAttachments(res.attachmentsEnabled);
      setOffline(false);
    } catch (err) {
      if ((err as { status?: number }).status === 0) setOffline(true);
    } finally {
      setLoaded(true);
    }
  }, [merge, notify]);

  useEffect(() => {
    void poll();
    let timer: ReturnType<typeof setInterval> | undefined;
    const startTimer = () => {
      clearInterval(timer);
      timer = setInterval(() => document.visibilityState === "visible" && void poll(), chatConfig.pollIntervalMs);
    };
    const onVisible = () => document.visibilityState === "visible" && void poll();
    startTimer();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const deliver = useCallback(
    async (m: LocalMessage) => {
      setPending((p) => p.map((x) => (x.clientMessageId === m.clientMessageId ? { ...x, local: "sending" } : x)));
      try {
        const res = await api<{ message: ChatMessage }>("/api/chat", {
          method: "POST",
          json: { clientMessageId: m.clientMessageId, body: m.body, fileIds: m.files.map((f) => f.id) },
        });
        known.current?.add(res.message.id);
        merge([res.message]);
        setOffline(false);
      } catch (err) {
        if ((err as { status?: number }).status === 0) setOffline(true);
        setPending((p) => p.map((x) => (x.clientMessageId === m.clientMessageId ? { ...x, local: "failed" } : x)));
      }
    },
    [merge],
  );

  // When the network comes back, resend failed messages.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    const onOnline = () => {
      pendingRef.current.filter((m) => m.local === "failed").forEach((m) => void deliver(m));
      void poll();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [deliver, poll]);

  const send = async (body: string, files: PublicFile[]) => {
    const clientMessageId = newId();
    const local: LocalMessage = {
      id: clientMessageId,
      clientMessageId,
      sender: "visitor",
      body,
      files,
      createdAt: new Date().toISOString(),
      local: "sending",
    };
    setPending((p) => [...p, local]);
    await deliver(local);
  };

  const all: LocalMessage[] = [...messages, ...pending];

  return (
    <section aria-labelledby="chat-title" className="glass overflow-hidden rounded-(--radius-tile)">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span aria-hidden className={`size-2.5 rounded-full ${offline ? "bg-danger" : "bg-ok"}`} />
        <h2 id="chat-title" className="font-semibold">
          {content.chat.title}
        </h2>
        {offline && <span className="ml-auto text-xs text-danger">{content.chat.offline}</span>}
        <SoundToggle
          scope="visitor"
          labelOn={content.chat.soundOn}
          labelOff={content.chat.soundOff}
          onChange={(v) => (soundOn.current = v)}
          className={offline ? "" : "ml-auto"}
        />
      </header>
      <div className="max-h-[55vh] min-h-48 overflow-y-auto px-4 py-5 sm:px-5">
        {loaded ? (
          <MessageList messages={all} viewer="visitor" onRetry={(m) => void deliver(m)} emptyText={content.chat.waiting} />
        ) : (
          <div className="space-y-3" aria-hidden>
            <div className="skeleton h-12 w-2/3 rounded-2xl" />
            <div className="skeleton ml-auto h-10 w-1/2 rounded-2xl" />
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <Composer
          onSend={send}
          uploadUrl="/api/uploads"
          uploadPurpose="chat"
          accept={[...uploadConfig.screenshotTypes]}
          attachmentsEnabled={attachments}
          maxFiles={uploadConfig.maxFilesPerMessage}
        />
      </div>
    </section>
  );
}
