"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MessageCircle, X } from "lucide-react";
import { content } from "@/config/content";
import { defaultManager, type ManagerProfile } from "@/config/managers";
import type { CandidateOutcome } from "@/config/candidate-outcome";
import { chatConfig, uploadConfig } from "@/config/settings";
import { api, newId, type ChatMessage, type PublicFile, type MessagePage, type MessageChanges } from "@/lib/api";
import { mergeMessages, reconcileMessageChanges, rememberMessageChanges } from "@/lib/chat";
import { MessageList, type LocalMessage } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { SoundToggle } from "../ui/SoundToggle";
import { ManagerAvatar } from "../chat/ManagerAvatar";
import { playChime } from "@/lib/sound";

type ChatResponse = MessagePage & { attachmentsEnabled: boolean; manager: ManagerProfile; outcome: CandidateOutcome | null; changes: MessageChanges };

/**
 * Built-in chat. New messages arrive by polling every few seconds (paused while the tab is hidden).
 * Sending is idempotent: a retry after a network error reuses the same clientMessageId.
 */
export function VisitorChat({ onOutcome, acknowledgement = null, closed = false, collapsible = false, active = true }: {
  onOutcome?: (outcome: CandidateOutcome | null) => void;
  acknowledgement?: ChatMessage | null;
  closed?: boolean;
  collapsible?: boolean;
  active?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(0);
  const open = !collapsible || expanded;
  const activeRef = useRef(active);
  const openRef = useRef(active && open);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    openRef.current = active && open;
    // A step transition can reveal the same conversation without clicking the launcher.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active && open) setUnread(0);
  }, [active, open]);
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
  const acknowledged = useRef(new Set<string>());
  const soundOn = useRef(true);

  const notify = useCallback((incoming: ChatMessage[], silent = false) => {
    if (known.current === null) {
      known.current = new Set(incoming.map((m) => m.id));
      return;
    }
    const fresh = incoming.filter((m) => !known.current!.has(m.id));
    fresh.forEach((m) => known.current!.add(m.id));
    // The revision panel sounds its own notice; its optional chat copy must not chime again.
    const replies = fresh.filter((m) => m.sender !== "visitor" && !acknowledged.current.has(m.clientMessageId) && !m.clientMessageId.startsWith("revision-request:"));
    if (!silent && replies.length) {
      if (!openRef.current) setUnread(count => Math.min(99, count + replies.length));
      if (soundOn.current) playChime("message");
    }
  }, []);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const previous = reconcileMessageChanges(prev, changes.current);
      const idByClient = new Map(previous.map(message => [message.clientMessageId, message.id]));
      const distinct = reconcileMessageChanges(incoming, changes.current).filter(message => {
        const existingId = idByClient.get(message.clientMessageId);
        if (existingId && existingId !== message.id) return false;
        idByClient.set(message.clientMessageId, message.id);
        return true;
      });
      return mergeMessages(previous, distinct);
    });
    const ids = new Set(incoming.map((m) => m.clientMessageId));
    setPending((p) => p.filter((m) => !ids.has(m.clientMessageId)));
  }, []);

  useEffect(() => {
    if (!acknowledgement) return;
    // This is the persisted submit response, not an optimistic message. Keep the
    // receive cursor untouched so an older in-flight poll still loads all history.
    acknowledged.current.add(acknowledgement.clientMessageId);
    known.current?.add(acknowledgement.id);
    merge([acknowledgement]);
  }, [acknowledgement, merge]);

  const poll = useCallback(async () => {
    if (polling.current || !activeRef.current) return;
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
        notify(reconcileMessageChanges(res.messages, changes.current), closedRef.current || !activeRef.current);
        merge(res.messages);
        if (initial) setBefore(res.hasMore ? res.previousCursor : null);
        // A send response must never advance this receive cursor.
        last.current = res.nextCursor ?? last.current;
        more = activeRef.current && (res.changes.hasMore || (!initial && res.hasMore && res.messages.length > 0));
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
    if (!active) return;
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
  }, [poll, active]);

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
  const assignedManager = manager ?? defaultManager;
  const close = () => {
    setExpanded(false);
    requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
  };
  const toggle = () => {
    if (open) { close(); return; }
    setExpanded(true);
    setUnread(0);
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
  };

  // Keep polling while the chat is closed so a retracted result restores it without a reload.
  if (closed) return null;

  return (
    <section aria-labelledby={collapsible ? "task-chat-title" : "chat-title"} className={`glass min-w-0 overflow-hidden rounded-(--radius-tile) ${collapsible ? "border-paint/45 shadow-[0_0_32px_-18px_var(--color-paint)]" : ""}`}>
      {collapsible && <button ref={launcher} type="button" aria-expanded={open} aria-controls="visitor-chat-panel" onClick={toggle} className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-4 bg-gradient-to-r from-paint/10 to-transparent p-4 text-left transition-colors hover:bg-paint/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-paint sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-5">
        <ManagerAvatar manager={assignedManager} size={52} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span id="task-chat-title" className="text-lg font-semibold leading-tight sm:text-xl">{content.taskChat.title}</span>
            <span role="status" aria-live="polite" aria-atomic="true">
              {unread > 0 && !open && <span aria-label={content.taskChat.newMessages(unread)} className="inline-grid min-w-6 place-items-center rounded-full bg-paint px-2 py-1 text-xs font-bold text-on-paint">{unread}</span>}
            </span>
          </span>
          <span className="mt-1 block text-xs font-semibold text-cyan">{assignedManager.name}</span>
          <span className="mt-1.5 block text-sm leading-relaxed text-ink-soft">{content.taskChat.hint}</span>
        </span>
        <span className={`col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold sm:col-span-1 sm:col-start-3 sm:row-start-1 ${open ? "border border-paint/30 text-cyan" : "bg-paint text-on-paint shadow-[0_4px_24px_-10px_var(--color-paint)]"}`}>
          {!open && <MessageCircle aria-hidden="true" className="size-4 shrink-0" />}
          {open ? content.taskChat.close : content.taskChat.action}
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
        </span>
      </button>}
      <div id="visitor-chat-panel" ref={panel} hidden={!open} tabIndex={-1} onKeyDown={event => {
        if (collapsible && event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
      }}>
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        {manager ? <ManagerAvatar manager={manager} size={38} /> : <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-paint/10 text-cyan"><MessageCircle className="size-4" /></span>}
        <div className="min-w-0 flex-1">
          <h2 id="chat-title" className="text-sm font-semibold">{manager?.name ?? content.chat.title}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{content.chat.workingHours}</p>
        </div>
        <SoundToggle
          scope="visitor"
          labelOn={content.chat.soundOn}
          labelOff={content.chat.soundOff}
          onChange={(v) => (soundOn.current = v)}
          className="shrink-0"
        />
        {collapsible && <button type="button" onClick={close} className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-soft transition-colors hover:border-paint/40 hover:text-cyan" aria-label={content.taskChat.close}><X aria-hidden="true" className="size-4" /></button>}
      </header>
      {offline && <p role="status" className="border-b border-line px-5 py-3 text-xs leading-relaxed text-danger">{content.chat.offline}</p>}
      <div className="max-h-[55vh] min-h-48 overflow-y-auto px-4 py-5 sm:px-5">
        {before && <button type="button" className="btn btn-ghost mb-4" disabled={loadingEarlier} onClick={() => void loadEarlier()}>{content.chat.loadEarlier}</button>}
        {historyError && <p role="alert" className="mb-3 text-sm text-danger">{historyError}</p>}
        {loaded || acknowledgement ? (
          <MessageList messages={all} viewer="visitor" manager={manager} onRetry={(m) => void deliver(m)} emptyText={collapsible ? content.taskChat.waiting : content.chat.waiting} />
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
          accept={[...uploadConfig.chatAttachmentTypes]}
          attachmentsEnabled={attachments}
          maxFiles={uploadConfig.maxFilesPerMessage}
        />
      </div>
      </div>
    </section>
  );
}
