"use client";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { playChime } from "@/lib/sound";
import { useAdminI18n } from "./i18n";
import { toast } from "./toast";
import { reminderCopy } from "@/config/admin-reminders";

type Activity = {
  now: string;
  leads: { id: number; name: string | null; at: string }[];
  messages: { id: string; leadId: number; name: string | null; preview: string; at: string }[];
  reviews?: { id: string; name: string; at: string }[];
  reminders?: { id: string; leadId: number; body: string; dueAt: string; revision: number }[];
  dueReminderCount?: number;
};

/** Fired after new activity so the open list / lead page reloads immediately. */
export const ACTIVITY_EVENT = "nl-admin-activity";
const POLL_MS = 5000;

/**
 * Polls for new leads, visitor messages, reviews, and due shared reminders.
 * Works on every admin page while the tab is open (also in the background).
 */
export function ActivityNotifier({ soundOn }: { soundOn: boolean }) {
  const { t, lang } = useAdminI18n();
  const since = useRef<string | null>(null);
  const seen = useRef(new Map<string, number>());
  const polling = useRef(false);
  const sound = useRef(soundOn);
  const dict = useRef(t);
  const reminderDict = useRef(reminderCopy[lang]);
  useEffect(() => {
    sound.current = soundOn;
    dict.current = t;
    reminderDict.current = reminderCopy[lang];
  }, [soundOn, t, lang]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (polling.current || stopped) return;
      polling.current = true;
      try {
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        const res = await api<Activity>(`/api/admin/activity${q}`);
        const first = since.current === null;
        since.current = new Date(Date.parse(res.now) - 1000).toISOString();
        for (const [key, at] of seen.current) if (at < Date.now() - 10 * 60_000) seen.current.delete(key);
        if (stopped) return;
        if (first) {
          // Surface the backlog once, silently. Opening the panel never replays old chimes.
          for (const reminder of res.reminders ?? []) seen.current.set(`reminder-${reminder.id}-${reminder.revision}-${reminder.dueAt}`, Date.now());
          if (res.dueReminderCount) toast({ kind: "info", title: reminderDict.current.outstanding(res.dueReminderCount), href: "/admin/reminders" });
          return;
        }

        const n = dict.current.ui.notify;
        let count = 0;
        for (const l of res.leads) {
          const key = `lead-${l.id}`;
          if (seen.current.has(key)) continue;
          seen.current.set(key, Date.now());
          count++;
          toast({ kind: "info", title: n.newLead(l.id, l.name), href: `/admin/leads/${l.id}` });
        }
        for (const m of res.messages) {
          const key = `msg-${m.id}`;
          if (seen.current.has(key)) continue;
          seen.current.set(key, Date.now());
          count++;
          toast({ kind: "info", title: n.newMessage(m.leadId, m.name), body: m.preview, href: `/admin/leads/${m.leadId}` });
        }
        for (const r of res.reviews ?? []) {
          const key = `review-${r.id}`;
          if (seen.current.has(key)) continue;
          seen.current.set(key, Date.now());
          count++;
          toast({ kind: "info", title: n.newReview(r.name), href: "/admin/reviews?tab=site" });
        }
        const dueReminders = (res.reminders ?? []).filter(reminder => {
          const key = `reminder-${reminder.id}-${reminder.revision}-${reminder.dueAt}`;
          if (seen.current.has(key)) return false;
          seen.current.set(key, Date.now());
          return true;
        });
        count += dueReminders.length;
        if (dueReminders.length > 3) {
          toast({ kind: "info", title: reminderDict.current.outstanding(res.dueReminderCount ?? dueReminders.length), href: "/admin/reminders" });
        } else for (const reminder of dueReminders) {
          toast({ kind: "info", title: reminderDict.current.dueToast(reminder.leadId), body: reminder.body, href: `/admin/leads/${reminder.leadId}#lead-reminders` });
        }
        if (!count) return;
        if (sound.current) playChime(res.leads.length ? "lead" : "message");
        window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT));
      } catch {
        /* offline or logged out: try again on the next tick */
      } finally { polling.current = false; }
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
