import "server-only";
import { createHash } from "node:crypto";

/** Non-authorizing local dedup scope; neither visitor access token nor Meta user ID. */
export function marketingScope(sessionId: string) {
  return createHash("sha256").update(`alleybiz-meta-stage-v1:${sessionId}`).digest("hex");
}
