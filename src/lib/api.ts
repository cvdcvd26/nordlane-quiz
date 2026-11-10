"use client";
import { content } from "@/config/content";
import { maintenanceEvent } from "@/config/maintenance";
import type { RichTextDocument } from "@/lib/rich-text";
import { candidateIdentityIsCurrent } from "@/lib/candidate-identity";

function notifyMaintenance(status: number, code?: string) {
  if (status === 503 && code === "maintenance" && typeof window !== "undefined") window.dispatchEvent(new Event(maintenanceEvent));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

function assertCurrentCandidateIdentity(url: string) {
  // Admin requests use separate credentials and must not be interrupted by a
  // candidate logging in elsewhere in the same browser. Auth calls deliberately
  // change cookies; their successful completion broadcasts the new generation.
  const path = url.split("?")[0];
  const visitor = /^\/api\/(?:session|contact|submit|chat|uploads|quiz|visitor|task-revisions)(?:\/|$)/.test(path)
    || path === "/api/candidate/read";
  if (visitor && !candidateIdentityIsCurrent()) {
    throw new ApiError("Konto zmieniło się w innej karcie. Odświeżamy Twoje zgłoszenie.", 401, "candidate_identity_changed");
  }
}

/** fetch wrapper: JSON in/out, readable errors, network failures → ApiError(status 0). */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  assertCurrentCandidateIdentity(url);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(content.errors.network, 0, "network");
  }
  const data = await res.json().catch(() => ({}));
  assertCurrentCandidateIdentity(url);
  if (!res.ok) {
    notifyMaintenance(res.status, data.code);
    throw new ApiError(data.error ?? content.errors.generic, res.status, data.code);
  }
  return data as T;
}

/** Upload with progress events (fetch has no upload progress). */
export function uploadWithProgress<T>(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<T>; abort: () => void } {
  try { assertCurrentCandidateIdentity(url); }
  catch (error) { return { promise: Promise.reject(error), abort: () => {} }; }
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try { assertCurrentCandidateIdentity(url); }
      catch (error) { reject(error); return; }
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        notifyMaintenance(xhr.status, data.code);
        reject(new ApiError(data.error ?? content.errors.generic, xhr.status, data.code));
      }
    };
    xhr.onerror = () => reject(new ApiError(content.errors.network, 0, "network"));
    xhr.onabort = () => reject(new ApiError("aborted", 0, "aborted"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

const displayTimeZone = "Europe/Warsaw";
const calendarDates = new Map<string, Intl.DateTimeFormat>();

/** Visitors use Poland's clock; admins pass their own zone, including for day boundaries. */
export function formatTime(iso: string, locale: string = content.locale, timeZone: string = displayTimeZone) {
  let calendarDate = calendarDates.get(timeZone);
  if (!calendarDate) {
    calendarDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    calendarDates.set(timeZone, calendarDate);
  }
  const d = new Date(iso);
  const today = new Date();
  const sameDay = calendarDate.format(d) === calendarDate.format(today);
  return d.toLocaleString(locale, {
    timeZone,
    hourCycle: "h23",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type PublicFile = { id: string; name: string; mime: string; size: number; url: string };
export type ChatMessage = {
  id: string;
  sequence?: string;
  sender: "visitor" | "admin" | "system";
  body: string;
  bodyRich?: RichTextDocument | null;
  createdAt: string;
  clientMessageId: string;
  changeRevision?: number;
  files: PublicFile[];
};

export type MessageChanges = { updates: ChatMessage[]; deletedIds: string[]; cursor: string; hasMore: boolean };
export type MessageChange = { id: string; body: string; bodyRich?: RichTextDocument | null; changeRevision: number; deleted: boolean };

export type MessagePage = {
  messages: ChatMessage[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
};
