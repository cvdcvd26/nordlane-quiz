"use client";

import { useEffect, useRef } from "react";

type DraftSource = { setDirty: (dirty: boolean) => void; dispose: () => void };
type ClickLike = object & { nativeEvent?: object };

/** Each mounted form owns its own entry, even when several forms share a lead scope. */
export function createAdminDraftRegistry() {
  const sources = new Map<symbol, { scope: string; dirty: boolean }>();
  const decisions = new WeakMap<object, boolean>();
  const hasDirty = (scope?: string) => {
    for (const source of sources.values()) if (source.dirty && (scope === undefined || source.scope === scope)) return true;
    return false;
  };
  return {
    register(scope: string): DraftSource {
      const key = Symbol(scope);
      const source = { scope, dirty: false };
      sources.set(key, source);
      return {
        setDirty(dirty) { if (sources.has(key)) source.dirty = dirty; },
        dispose() { sources.delete(key); },
      };
    },
    hasDirty,
    /** Capture listeners and React handlers share one decision for the same native click. */
    confirm(message: string, event?: ClickLike, ask: (message: string) => boolean = message => window.confirm(message)): boolean {
      const key = event?.nativeEvent ?? event;
      if (key && decisions.has(key)) return decisions.get(key)!;
      if (!hasDirty()) return true;
      const accepted = ask(message);
      if (key) decisions.set(key, accepted);
      return accepted;
    },
  };
}

const registry = createAdminDraftRegistry();

/** No form values are registered or persisted; only the scope and dirty flag leave the form. */
export function useAdminDraftGuard(scope: string, dirty: boolean) {
  const source = useRef<DraftSource | null>(null);
  useEffect(() => {
    const registered = registry.register(scope);
    source.current = registered;
    return () => { registered.dispose(); source.current = null; };
  }, [scope]);
  useEffect(() => { source.current?.setDirty(dirty); }, [scope, dirty]);
}

/** Read at navigation time or inside beforeunload; there is no subscription to keep stale. */
export const hasDirtyAdminDrafts = (scope?: string) => registry.hasDirty(scope);
export const confirmAdminDraftNavigation = (message: string, event?: ClickLike) => registry.confirm(message, event);

type LinkNavigation = {
  href: string; currentUrl: string; target?: string; download?: boolean; button?: number;
  metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; defaultPrevented?: boolean;
};

/** Same-page query/hash changes preserve the lead forms, and new tabs preserve this page. */
export function shouldGuardAdminDraftLink(link: LinkNavigation): boolean {
  if (link.defaultPrevented || link.download || (link.button ?? 0) !== 0 || link.metaKey || link.ctrlKey || link.shiftKey || link.altKey) return false;
  if (link.target && link.target.toLowerCase() !== "_self") return false;
  try {
    const current = new URL(link.currentUrl);
    const next = new URL(link.href, current);
    return ["http:", "https:"].includes(next.protocol) && next.origin === current.origin && next.pathname !== current.pathname;
  } catch { return false; }
}

/** Optional global coverage for menu links, breadcrumbs, toasts and other internal anchors. */
export function installAdminDraftLinkGuard(getMessage: () => string): () => void {
  const onClick = (event: MouseEvent) => {
    const element = event.target instanceof Element ? event.target : null;
    const anchor = element?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !shouldGuardAdminDraftLink({
      href: anchor.href, currentUrl: window.location.href, target: anchor.target,
      download: anchor.hasAttribute("download"), button: event.button, defaultPrevented: event.defaultPrevented,
      metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey,
    })) return;
    if (!confirmAdminDraftNavigation(getMessage(), event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
