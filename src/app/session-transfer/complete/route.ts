import { siteDomains } from "@/config/site-domains";
import { assertTransferHost } from "@/server/domain-session-transfer";
import { transferPage, transferRoute } from "@/server/domain-transfer-http";

export const GET = transferRoute(async request => {
  assertTransferHost(request.url, siteDomains.canonical);
  return transferPage(true);
});
