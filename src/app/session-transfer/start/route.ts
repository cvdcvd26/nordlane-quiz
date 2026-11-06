import { startDomainSessionTransfer } from "@/server/domain-session-transfer";
import { transferRedirect, transferRoute } from "@/server/domain-transfer-http";
import { clientIp } from "@/server/http";

export const GET = transferRoute(async request => transferRedirect(await startDomainSessionTransfer(
  request.url, new URL(request.url).searchParams.get("path"), clientIp(request),
)));
