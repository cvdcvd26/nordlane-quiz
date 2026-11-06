import { skipDomainSessionTransfer } from "@/server/domain-session-transfer";
import { transferRedirect, transferRoute } from "@/server/domain-transfer-http";

export const GET = transferRoute(async request => transferRedirect(await skipDomainSessionTransfer(request.url)));
