import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError, forbidden } from "./errors";
import { log } from "./log";
import { content } from "@/config/content";
import { readBody } from "./body";
import { assertVisitorAvailable } from "./maintenance";

const visitorScopes = new Set([
  "session", "contact", "quiz.answer", "submit", "uploads", "uploads.delete",
  "chat.get", "chat.post", "testimonials.list", "files.get",
]);

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Wraps a route handler: maps AppError/ZodError to JSON responses and logs unexpected errors. */
export function route<A extends unknown[]>(scope: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      // Stop before cookies, rate limits, payload parsing, file reads, or any visitor writes.
      if (visitorScopes.has(scope)) await assertVisitorAvailable({ allowAdmin: scope === "files.get" });
      return await fn(...args);
    } catch (err) {
      // Let Next.js internal signals through (e.g. "this route is dynamic" during prerendering).
      unstable_rethrow(err);
      if (err instanceof AppError) {
        const response = json({ error: err.message, code: err.code }, err.status);
        if (err.code === "maintenance") response.headers.set("Retry-After", "60");
        return response;
      }
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
