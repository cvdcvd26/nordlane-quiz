/** Neon requires its WebSocket transport; other PostgreSQL hosts use pg/TCP. */
export function databaseDriver(url: string, override = process.env.DATABASE_DRIVER) {
  if (override && override !== "postgres" && override !== "neon") throw new Error("DATABASE_DRIVER must be postgres or neon");
  if (override) return override;
  return new URL(url).hostname.endsWith(".neon.tech") ? "neon" : "postgres";
}
