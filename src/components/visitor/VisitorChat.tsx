"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { content } from "@/config/content";
import type { ManagerProfile } from "@/config/managers";
import type { CandidateOutcome } from "@/config/candidate-outcome";
import { chatConfig, uploadConfig } from "@/config/settings";
import { api, newId, type ChatMessage, type PublicFile, type MessagePage, type MessageChanges } from "@/lib/api";
import { mergeMessages, reconcileMessageChanges, rememberMessageChanges } from "@/lib/chat";
import { MessageList, type LocalMessage } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { SoundToggle } from "../ui/SoundToggle";
import { playChime } from "@/lib/sound";

type ChatResponse = MessagePage & { attachmentsEnabled: boolean; manager: ManagerProfile; outcome: CandidateOutcome | null; changes: MessageChanges };

/**
 * Built-in chat. New messages arrive by polling every few seconds (paused while the tab is hidden).
 * Sending is idempotent: a retry after a network error reuses the same clientMessageId.
 */
export function VisitorChat({ onOutcome, closed = false }: { onOutcome?: (outcome: CandidateOutcome | null) => void; closed?: boolean }) {
  const closedRef = useRef(closed);
  useEffect(() => {
    closedRef.current = closed;
  }, [closed]);
  const outcomeCallback = useRef(onOutcome);
  useEffect(() => {
    outcomeCallback.current = onOutcome;
  }, [onOutcome]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<LocalMessage[]>([]);
  const [attachments, setAttachments] = useState(false);
  const [manager, setManager] = useState<ManagerProfile | null>(null);
  const [offline, setOffline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const last = useRef<string | undefined>(undefined);
  const changesAfter = useRef<string | undefined>(undefined);
  const changes = useRef(new Map<string, ChatMessage | null>());
  const polling = useRef(false);
  const [before, setBefore] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Ids already shown; the chime plays only for admin/system messages that arrive after the first load.
  const known = useRef<Set<string> | null>(null);
  const soundOn = useRef(true);

  const notify = useCallback((incoming: ChatMessage[], silent = false) => {
    if (known.current === null) {
      known.current = new Set(incoming.map((m) => m.id));
      return;
    }
    const fresh = incoming.filter((m) => !known.current!.has(m.id));
    fresh.forEach((m) => known.current!.add(m.id));
    if (!silent && soundOn.current && fresh.some((m) => m.sender !== "visitor")) playChime("message");
  }, []);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => mergeMessages(reconcileMessageChanges(prev, changes.current), reconcileMessageChanges(incoming, changes.current)));
    const ids = new Set(incoming.map((m) => m.clientMessageId));
    setPending((p) => p.filter((m) => !ids.has(m.clientMessageId)));
  }, []);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      let more = true;
      while (more) {
        const initial = !last.current;
        const params = new URLSearchParams();
        if (last.current) params.set("after", last.current);
        if (changesAfter.current !== undefined) params.set("changesAfter", changesAfter.current);
        const res = await api<ChatResponse>(`/api/chat?${params}`);
        rememberMessageChanges(changes.current, res.changes.updates, res.changes.deletedIds);
        setMessages(previous => reconcileMessageChanges(previous, changes.current));
        changesAfter.current = res.changes.cursor;
        closedRef.current = Boolean(res.outcome);
        notify(reconcileMessageChanges(res.messages, changes.current), closedRef.current);
        merge(res.messages);
        if (initial) setBefore(res.hasMore ? res.previousCursor : null);
        // A send response must never advance this receive cursor.
        last.current = res.nextCursor ?? last.current;
        more = res.changes.hasMore || (!initial && res.hasMore && res.messages.length > 0);
        setAttachments(res.attachmentsEnabled);
        setManager(res.manager);
        outcomeCallback.current?.(res.outcome);
      }
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      polling.current = false;
      setLoaded(true);
    }
  }, [merge, notify]);

  const loadEarlier = async () => {
    if (!before || loadingEarlier) return;
    setLoadingEarlier(true);
    setHistoryError(null);
    try {
      const res = await api<ChatResponse>(`/api/chat?before=${encodeURIComponent(before)}`);
      res.messages.forEach((m) => known.current?.add(m.id));
      merge(res.messages);
      setBefore(res.hasMore ? res.previousCursor : null);
    } catch (err) {
      setHistoryError((err as Error).message);
    } finally { setLoadingEarlier(false); }
  };

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
      if (closedRef.current) return;
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
        if ((err as { code?: string }).code === "candidate_chat_closed") void poll();
        if ((err as { status?: number }).status === 0) setOffline(true);
        setPending((p) => p.map((x) => (x.clientMessageId === m.clientMessageId ? { ...x, local: "failed" } : x)));
      }
    },
    [merge, poll],
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

  const confirmed = new Set(messages.map((m) => m.clientMessageId));
  const all: LocalMessage[] = [...messages, ...pending.filter((m) => !confirmed.has(m.clientMessageId))];

  // Keep polling while the chat is closed so a retracted result restores it without a reload.
  if (closed) return null;

  return (
    <section aria-labelledby="chat-title" className="glass overflow-hidden rounded-(--radius-tile)">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <span aria-hidden className={`size-2.5 rounded-full ${offline ? "bg-danger" : "bg-ok"}`} />
        <div className="min-w-0">
          <h2 id="chat-title" className="font-semibold">{content.chat.title}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{content.chat.workingHours}</p>
        </div>
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
        {before && <button type="button" className="btn btn-ghost mb-4" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{content.chat.loadEarlier}</button>}
        {historyError && <p role="alert" className="mb-3 text-sm text-danger">{historyError}</p>}
        {loaded ? (
          <MessageList messages={all} viewer="visitor" manager={manager} onRetry={(m) => void deliver(m)} emptyText={content.chat.waiting} />
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
