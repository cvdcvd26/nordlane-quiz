"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CheckCircle2, CircleAlert, Bell, X } from "lucide-react";
import { useAdminI18n } from "./i18n";

export type ToastInput = { kind: "success" | "error" | "info"; title: string; body?: string; href?: string; linkLabel?: string };
type ToastItem = ToastInput & { id: number };

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Shows a short message in the bottom-right corner (errors stay a little longer). */
export function toast(input: ToastInput) {
  const id = ++seq;
  items = [{ ...input, id }, ...items].slice(0, 4);
  emit();
  setTimeout(() => dismissToast(id), input.kind === "error" ? 9000 : input.href ? 9000 : 4000);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const EMPTY: ToastItem[] = [];

const icon = {
  success: <CheckCircle2 aria-hidden className="size-4 text-adm-green" />,
  error: <CircleAlert aria-hidden className="size-4 text-adm-red" />,
  info: <Bell aria-hidden className="size-4 text-adm-accent" />,
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const { t } = useAdminI18n();
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {list.map((m) => (
        <div
          key={m.id}
          role={m.kind === "error" ? "alert" : "status"}
          className="adm-panel pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 shadow-[0_4px_16px_-6px_rgb(0_0_0/0.18)]"
        >
          <span className="mt-0.5">{icon[m.kind]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">{m.title}</p>
            {m.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-adm-ink-2">{m.body}</p>}
            {m.href && (
              <Link href={m.href} onClick={() => dismissToast(m.id)} className="mt-1 inline-block text-[13px] font-semibold text-adm-accent hover:underline">
                {m.linkLabel ?? t.ui.notify.open}
              </Link>
            )}
          </div>
          <button type="button" aria-label={t.ui.notify.close} onClick={() => dismissToast(m.id)} className="text-adm-ink-3 hover:text-adm-ink">
            <X aria-hidden className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
