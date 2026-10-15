"use client";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { playChime } from "@/lib/sound";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";

type Activity = {
  now: string;
  leads: { id: number; name: string | null; at: string }[];
  messages: { leadId: number; name: string | null; preview: string; at: string }[];
};

/** Fired after new activity so the open list / lead page reloads immediately. */
export const ACTIVITY_EVENT = "nl-admin-activity";
const POLL_MS = 5000;

/**
 * Polls /api/admin/activity, plays a chime and shows a toast for new leads and visitor messages.
 * Works on every admin page while the tab is open (also in the background).
 */
export function ActivityNotifier({ soundOn }: { soundOn: boolean }) {
  const { t } = useAdminI18n();
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  const sound = useRef(soundOn);
  const dict = useRef(t);
  useEffect(() => {
    sound.current = soundOn;
    dict.current = t;
  }, [soundOn, t]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const res = await api<Activity>(`/api/admin/activity${q}`);
        const first = since.current === null;
        since.current = res.now;
        if (first || stopped) return; // the first call only sets the starting point

        const n = dict.current.ui.notify;
        let count = 0;
        for (const l of res.leads) {
          const key = `lead-${l.id}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          count++;
          toast({ kind: "info", title: n.newLead(l.id, l.name), href: `/admin/leads/${l.id}` });
        }
        for (const m of res.messages) {
          const key = `msg-${m.leadId}-${m.at}`;
          if (seen.current.has(key)) continue;
          seen.current.add(key);
          count++;
          toast({ kind: "info", title: n.newMessage(m.leadId, m.name), body: m.preview, href: `/admin/leads/${m.leadId}` });
        }
        if (!count) return;
        if (sound.current) playChime(res.leads.length ? "lead" : "message");
        window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
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

  return null;
}
