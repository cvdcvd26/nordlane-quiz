/** Structured logs: Vercel → Logs can filter by `scope`. */
export const log = {
  info: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: "info", scope, msg, ...extra })),
  warn: (scope: string, msg: string, extra?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ level: "warn", scope, msg, ...extra })),
  error: (scope: string, msg: string, err?: unknown, extra?: Record<string, unknown>) =>
    console.error(
      JSON.stringify({
        level: "error",
        scope,
        msg,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        ...extra,
      }),
    ),
};
