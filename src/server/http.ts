import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError, forbidden } from "./errors";
import { log } from "./log";
import { content } from "@/config/content";
import { readBody } from "./body";

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Wraps a route handler: maps AppError/ZodError to JSON responses and logs unexpected errors. */
export function route<A extends unknown[]>(scope: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      // Let Next.js internal signals through (e.g. "this route is dynamic" during prerendering).
      unstable_rethrow(err);
      if (err instanceof AppError) return json({ error: err.message, code: err.code }, err.status);
      if (err instanceof ZodError)
        return json({ error: err.issues[0]?.message ?? content.errors.generic, code: "validation" }, 400);
      log.error(scope, "unhandled error", err);
      return json({ error: content.errors.generic, code: "internal" }, 500);
    }
  };
}

/** CSRF protection for state-changing requests: the Origin must be this site. */
export function assertSameOrigin(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") throw forbidden();
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (no cookies sent by browsers cross-site without Origin)
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    const parsed = new URL(origin);
    const protocol = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    if (parsed.host !== host || parsed.protocol !== `${protocol}:`) throw forbidden();
  } catch {
    throw forbidden();
  }
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function readJson(req: Request): Promise<unknown> {
  const body = await readBody(req, 32 * 1024);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}
