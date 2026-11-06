import { authorizeDomainSessionTransfer } from "@/server/domain-session-transfer";
import { transferRedirect, transferRoute } from "@/server/domain-transfer-http";
import { clientIp } from "@/server/http";

export const GET = transferRoute(async request => transferRedirect(await authorizeDomainSessionTransfer(
  request.url, new URL(request.url).searchParams.get("state"), clientIp(request),
)));
