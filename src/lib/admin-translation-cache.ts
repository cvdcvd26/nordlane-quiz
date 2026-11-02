"use client";
import { ApiError } from "./api";

/** A concurrent admin pane may already be paying for this source. Poll only its cache. */
export async function waitForCachedTranslation<T>(read: () => Promise<T | null>, signal: AbortSignal): Promise<T | null> {
  for (const delay of [1000, 2000, 4000, 8000, 8000]) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
      signal.addEventListener("abort", abort, { once: true });
    });
    signal.throwIfAborted();
    try {
      const cached = await read();
      signal.throwIfAborted();
      if (cached) return cached;
    } catch (error) {
      signal.throwIfAborted();
      // A cache-only miss uses this code too; it does not establish that the budget was exhausted.
      if (!(error instanceof ApiError) || !["translation_limit_reached", "translation_busy"].includes(error.code ?? "")) throw error;
    }
  }
  return null;
}
