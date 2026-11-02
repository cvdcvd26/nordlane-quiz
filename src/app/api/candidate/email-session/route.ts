import { route, json } from "@/server/http";
import { requireVisitorSessionId } from "@/server/visitor-session";
import { getCandidateEmailState } from "@/server/candidate-email-auth";

export const GET = route("candidate.email.session", async () =>
  json(await getCandidateEmailState(await requireVisitorSessionId())));
