import { siteDomains } from "@/config/site-domains";
import { completeDomainSessionTransfer } from "@/server/domain-session-transfer";
import { transferHeaders, transferRoute } from "@/server/domain-transfer-http";
import { forbidden } from "@/server/errors";
import { assertSameOrigin, clientIp, readJson } from "@/server/http";

export const POST = transferRoute(async request => {
  // Unlike ordinary APIs this endpoint accepts only the fixed new-origin browser.
  if (request.headers.get("origin") !== siteDomains.canonical) throw forbidden();
  assertSameOrigin(request);
  const result = await completeDomainSessionTransfer(request.url, await readJson(request, 1024), clientIp(request));
  return Response.json(result, { headers: transferHeaders });
}, true);
