import { requirePermanentAdmin } from "@/server/admin-auth";
import { assertSameOrigin, json, readJson, route } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { getLeadResult, updateLeadResult } from "@/server/services/lead-results";
import { leadIdFrom } from "../../lead-id";

type Context = { params: Promise<{ id: string }> };
const detail = route("admin.lead-result", async (_req: Request, ctx: Context) => {
  const admin = await requirePermanentAdmin();
  await rateLimit(`admin-lead-result-read:${admin.id}`, 120, 60);
  return json(await getLeadResult(leadIdFrom((await ctx.params).id)));
});
const update = route("admin.lead-result.update", async (req: Request, ctx: Context) => {
  const admin = await requirePermanentAdmin();
  assertSameOrigin(req);
  await rateLimit(`admin-lead-result-write:${admin.id}`, 60, 60);
  return json(await updateLeadResult(leadIdFrom((await ctx.params).id), admin.id, await readJson(req)));
});

export async function GET(req: Request, ctx: Context) {
  const response = await detail(req, ctx);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export async function PATCH(req: Request, ctx: Context) {
  const response = await update(req, ctx);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
