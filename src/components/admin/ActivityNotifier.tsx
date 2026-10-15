"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAdminI18n } from "./i18n";
import { api } from "@/lib/api";
import { playChime } from "@/lib/sound";

type Activity = {
  now: string;
  leads: { id: number; name: string | null; at: string }[];
  messages: { leadId: number; name: string | null; preview: string; at: string }[];
};
type Toast = { key: string; kind: "lead" | "message"; leadId: number; name: string | null; preview?: string };

/** Fired after new activity so the open list / lead page reloads immediately. */
export const ACTIVITY_EVENT = "nl-admin-activity";
const POLL_MS = 5000;

/**
 * Polls /api/admin/activity, plays a chime and shows a toast for new leads and visitor messages.
 * Works on every admin page, while the tab is open (also in the background).
 */
export function ActivityNotifier({ soundOn }: { soundOn: boolean }) {
  const { t: dict } = useAdminI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const sound = useRef(soundOn);
  useEffect(() => {
    sound.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const res = await api<Activity>(`/api/admin/activity${q}`);
        const first = since.current === null;
        since.current = res.now;
        if (first || stopped) return; // first call only sets the starting point

        const fresh: Toast[] = [];
        for (const l of res.leads) {
          const key = `lead-${l.id}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          fresh.push({ key, kind: "lead", leadId: l.id, name: l.name });
        }
        for (const m of res.messages) {
          const key = `msg-${m.leadId}-${m.at}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          fresh.push({ key, kind: "message", leadId: m.leadId, name: m.name, preview: m.preview });
        }
        if (!fresh.length) return;
        if (sound.current) playChime(res.leads.length ? "lead" : "message");
        setToasts((t) => [...fresh, ...t].slice(0, 4));
        window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
        fresh.forEach((f) => setTimeout(() => setToasts((t) => t.filter((x) => x.key !== f.key)), 9000));
      } catch {
        /* offline or logged out: try again on the next tick */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.key} className="glass pop pointer-events-auto rounded-2xl p-4 shadow-[0_12px_40px_-12px_#0099ff88]">
          <div className="flex items-start gap-3">
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-cyan shadow-[0_0_10px_#00d9ff]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.kind === "lead" ? dict.ui.notify.newLead(t.leadId, t.name) : dict.ui.notify.newMessage(t.leadId, t.name)}</p>
              {t.preview && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{t.preview}</p>}
              <Link href={`/admin/leads/${t.leadId}`} className="mt-2 inline-block text-sm font-semibold text-sky hover:underline">
                {dict.ui.notify.open} →
              </Link>
            </div>
            <button
              type="button"
              aria-label={dict.ui.notify.close}
              onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))}
              className="text-slate hover:text-ink"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
