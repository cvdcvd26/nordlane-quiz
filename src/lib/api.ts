"use client";
import { content } from "@/config/content";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** fetch wrapper: JSON in/out, readable errors, network failures → ApiError(status 0). */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
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
  if (!res.ok) throw new ApiError(data.error ?? content.errors.generic, res.status, data.code);
  return data as T;
}

/** Upload with progress events (fetch has no upload progress). */
export function uploadWithProgress<T>(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const data = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data.error ?? content.errors.generic, xhr.status, data.code));
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

export function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString(content.locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export type PublicFile = { id: string; name: string; mime: string; size: number; url: string };
export type ChatMessage = {
  id: string;
  sender: "visitor" | "admin" | "system";
  body: string;
  createdAt: string;
  clientMessageId: string;
  files: PublicFile[];
};
