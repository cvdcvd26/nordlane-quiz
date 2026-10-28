import { eq, sql, type SQL } from "drizzle-orm";
import { z, ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { db, schema } from "@/db";
import {
  leadClosures, leadQualifications, leadResultReasons, leadResultsConfig,
  type LeadResultDetail, type LeadResultState, type LeadResultsReport, type LeadResultsSource,
} from "@/config/lead-results";
import { parseAnalyticsRange } from "./analytics";
import { AppError, badRequest, conflict, notFound } from "../errors";

const updateSchema = z.object({
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  qualification: z.enum(leadQualifications),
  closure: z.enum(leadClosures),
  reason: z.enum(leadResultReasons).nullable(),
  comment: z.string().trim().max(leadResultsConfig.commentLimit),
  responsibleAdminId: z.uuid().nullable(),
}).strict();
const positiveString = z.string().regex(/^[1-9]\d{0,5}$/).transform(Number);
const reportSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "custom"]).optional(),
  from: z.string().optional(), to: z.string().optional(),
  source: z.string().max(1000).default("all"),
  responsible: z.union([z.literal("all"), z.literal("unassigned"), z.uuid()]).default("all"),
  page: positiveString.default(1),
  pageSize: positiveString.refine(n => n <= leadResultsConfig.maxPageSize).default(leadResultsConfig.pageSize),
}).strict();

const defaultState = (): LeadResultState => ({
  qualification: "unreviewed", closure: "open", reason: null, comment: "", responsibleAdminId: null,
  updatedById: null, version: 0, updatedAt: null, closedAt: null,
});
type ResultRow = typeof schema.leadResults.$inferSelect;
function state(row: ResultRow | undefined): LeadResultState {
  if (!row) return defaultState();
  return {
    qualification: row.qualification as LeadResultState["qualification"], closure: row.closure as LeadResultState["closure"],
    reason: row.reason as LeadResultState["reason"], comment: row.comment, responsibleAdminId: row.responsibleAdminId,
    updatedById: row.updatedBy, version: row.version, updatedAt: row.updatedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null,
  };
}
function validLeadId(leadId: number) {
  if (!Number.isSafeInteger(leadId) || leadId <= 0) throw notFound();
}
/** Fixed SQL aliases only. Defaults describe an unreviewed record, never a legacy status inference. */
const resultJson = sql`jsonb_build_object(
  'qualification', coalesce(r.qualification, 'unreviewed'), 'closure', coalesce(r.closure, 'open'),
  'reason', r.reason, 'comment', coalesce(r.comment, ''), 'responsibleAdminId', r.responsible_admin_id,
  'updatedById', r.updated_by, 'version', coalesce(r.version, 0), 'updatedAt', r.updated_at, 'closedAt', r.closed_at
)`;
const adminsJson = sql`(select coalesce(jsonb_agg(jsonb_build_object('id', au.id, 'email', au.email) order by au.email, au.id), '[]'::jsonb) from admin_users au)`;
function canonicalState(value: LeadResultState): LeadResultState {
  return { ...value, updatedAt: value.updatedAt ? new Date(value.updatedAt).toISOString() : null, closedAt: value.closedAt ? new Date(value.closedAt).toISOString() : null };
}
function canonicalDetail(detail: LeadResultDetail): LeadResultDetail {
  return { ...detail, leadId: Number(detail.leadId), result: canonicalState(detail.result), history: detail.history.map(h => ({
    ...h, previous: canonicalState(h.previous), next: canonicalState(h.next), createdAt: new Date(h.createdAt).toISOString(),
  })) };
}

async function getLeadResultImpl(leadId: number): Promise<LeadResultDetail> {
  validLeadId(leadId);
  // A single statement keeps current version and recent history on the same snapshot.
  const response = await db().execute(sql`
    select l.id as "leadId", r.lead_id is not null as "hasSavedResult", ${resultJson} as result,
      (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'previous', h.previous, 'next', h.next,
        'actor', case when au.id is null then null else jsonb_build_object('id', au.id, 'email', au.email) end,
        'createdAt', h.created_at) order by h.version desc), '[]'::jsonb)
       from (select * from lead_result_history where lead_id = l.id order by version desc limit ${leadResultsConfig.historyLimit}) h
       left join admin_users au on au.id = h.actor_id) as history,
      ${adminsJson} as "responsibleAdmins"
    from leads l left join lead_results r on r.lead_id = l.id where l.id = ${leadId}
  `);
  const detail = (response as unknown as { rows: LeadResultDetail[] }).rows[0];
  if (!detail) throw notFound();
  return canonicalDetail(detail);
}

async function updateLeadResultImpl(leadId: number, adminId: string, input: unknown, now = new Date()): Promise<LeadResultDetail> {
  validLeadId(leadId);
  const parsed = updateSchema.parse(input);
  if (!z.uuid().safeParse(adminId).success) throw badRequest("Invalid administrator.");
  // Closing outcome is authoritative, and an unsuitable lead always has its matching closure.
  let qualification = parsed.qualification;
  let closure = parsed.closure;
  if (closure === "signal_working") qualification = "suitable";
  else if (closure === "not_suitable") qualification = "unsuitable";
  if (qualification === "unsuitable") closure = "not_suitable";
  await db().transaction(async tx => {
    // Serialize even first saves (there may not yet be a result row to lock), and deletion.
    const [lead] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, leadId)).for("update");
    if (!lead) throw notFound();
    const [current] = await tx.select().from(schema.leadResults).where(eq(schema.leadResults.leadId, leadId));
    const previous = state(current);
    if (previous.version !== parsed.expectedVersion) throw conflict("This result changed. Reload before saving.", "lead_result_changed");
    if (parsed.responsibleAdminId) {
      // Temporary accesses represent actual operators too; manager avatars are never staff assignments.
      const [admin] = await tx.select({ id: schema.adminUsers.id }).from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, parsed.responsibleAdminId)).for("key share");
      if (!admin) throw badRequest("Choose an existing administrator.", "lead_result_responsible");
    }
    if (previous.qualification === qualification && previous.closure === closure && previous.reason === parsed.reason &&
      previous.comment === parsed.comment && previous.responsibleAdminId === parsed.responsibleAdminId) return;
    const closedAt = closure === "open" ? null : previous.closure === closure && previous.closedAt ? new Date(previous.closedAt) : now;
    const values = { qualification, closure, reason: parsed.reason, comment: parsed.comment,
      responsibleAdminId: parsed.responsibleAdminId, updatedBy: adminId, version: previous.version + 1, updatedAt: now, closedAt };
    const [saved] = current
      ? await tx.update(schema.leadResults).set(values).where(eq(schema.leadResults.leadId, leadId)).returning()
      : await tx.insert(schema.leadResults).values({ leadId, ...values }).returning();
    await tx.insert(schema.leadResultHistory).values({ leadId, previous, next: state(saved), actorId: adminId, version: saved.version, createdAt: now });
  });
  return getLeadResultImpl(leadId);
}

function sourceKey(source: LeadResultsSource) {
  return source.kind === "other" ? null : JSON.stringify([source.kind, source.source, source.medium, source.campaign]);
}
function sourceFilter(value: string): SQL {
  if (value === "all") return sql`true`;
  let tuple: unknown;
  try { tuple = JSON.parse(value); } catch { throw badRequest("Invalid source filter.", "lead_results_filter"); }
  const parsed = z.tuple([z.enum(["utm", "referrer", "direct", "unknown"]), z.string().max(253).nullable(), z.string().max(120).nullable(), z.string().max(120).nullable()]).safeParse(tuple);
  if (!parsed.success) throw badRequest("Invalid source filter.", "lead_results_filter");
  const [kind, source, medium, campaign] = parsed.data;
  return sql`kind = ${kind} and source is not distinct from ${source} and medium is not distinct from ${medium} and campaign is not distinct from ${campaign}`;
}
const counts = sql`count(*)::int as leads, count(*) filter(where qualification <> 'unreviewed')::int as reviewed,
  count(*) filter(where qualification = 'suitable')::int as suitable, count(*) filter(where closure = 'signal_working')::int as success`;

async function getLeadResultsImpl(input: Record<string, string | undefined>, now = new Date()): Promise<LeadResultsReport> {
  const parsed = reportSchema.parse(input);
  const range = parseAnalyticsRange({ period: parsed.period, from: parsed.from, to: parsed.to }, now);
  const sourceWhere = sourceFilter(parsed.source);
  const responsibleWhere = parsed.responsible === "all" ? sql`true` : parsed.responsible === "unassigned"
    ? sql`responsible_id is null` : sql`responsible_id = ${parsed.responsible}::uuid`;
  const offset = (parsed.page - 1) * parsed.pageSize;
  // All totals, groups, daily cohorts and list rows share one database snapshot and identical filters.
  const response = await db().execute(sql`
    with base as (
      select l.id, vc.name, vc.phone, l.status, l.created_at as "createdAt",
        to_char(l.created_at at time zone 'Europe/Warsaw', 'YYYY-MM-DD') as day,
        coalesce(r.qualification, 'unreviewed') as qualification, coalesce(r.closure, 'open') as closure,
        r.reason, ${resultJson} as result, r.lead_id is not null as "hasSavedResult",
        r.responsible_admin_id as responsible_id, au.email as responsible_email,
        coalesce(a.consent_all, false) as attributed,
        case when not coalesce(a.consent_all, false) then 'unknown'
          when coalesce(a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term) is not null then 'utm'
          when a.referrer_host is not null then 'referrer' else 'direct' end as kind,
        case when a.consent_all then coalesce(a.utm_source, a.referrer_host) end as source,
        case when a.consent_all then a.utm_medium end as medium,
        case when a.consent_all then a.utm_campaign end as campaign
      from leads l left join lead_results r on r.lead_id = l.id
      left join visitor_contacts vc on vc.session_id = l.session_id
      left join visitor_attribution a on a.session_id = l.session_id
      left join admin_users au on au.id = r.responsible_admin_id
      where l.created_at >= ${range.from} and l.created_at < ${range.end}
    ), cohort as (select * from base where (${sourceWhere}) and (${responsibleWhere})),
    source_options as (select kind, source, medium, campaign from base where (${responsibleWhere})
      group by kind, source, medium, campaign order by count(*) desc, kind, source nulls first, medium nulls first, campaign nulls first
      limit ${leadResultsConfig.maxGroups}),
    source_groups as (select kind, source, medium, campaign, ${counts} from cohort group by kind, source, medium, campaign),
    source_ranked as (select *, row_number() over(order by leads desc, kind, source nulls first, medium nulls first, campaign nulls first) as rank from source_groups),
    source_buckets as (select case when rank < ${leadResultsConfig.maxGroups} then kind else 'other' end as kind,
      case when rank < ${leadResultsConfig.maxGroups} then source end as source,
      case when rank < ${leadResultsConfig.maxGroups} then medium end as medium,
      case when rank < ${leadResultsConfig.maxGroups} then campaign end as campaign, leads, reviewed, suitable, success from source_ranked),
    sources as (select kind, source, medium, campaign, sum(leads)::int as leads, sum(reviewed)::int as reviewed,
      sum(suitable)::int as suitable, sum(success)::int as success from source_buckets group by kind, source, medium, campaign),
    responsible_groups as (select responsible_id, responsible_email, ${counts} from cohort group by responsible_id, responsible_email),
    responsible_ranked as (select *, row_number() over(order by leads desc, responsible_id nulls first) as rank from responsible_groups),
    responsible_buckets as (select case when rank >= ${leadResultsConfig.maxGroups} then 'other' when responsible_id is null then 'unassigned' else 'admin' end as kind,
      case when rank < ${leadResultsConfig.maxGroups} then responsible_id end as id,
      case when rank < ${leadResultsConfig.maxGroups} then responsible_email end as email, leads, reviewed, suitable, success from responsible_ranked),
    responsibles as (select kind, case when kind = 'admin' then jsonb_build_object('id', id, 'email', email) end as admin,
      sum(leads)::int as leads, sum(reviewed)::int as reviewed, sum(suitable)::int as suitable, sum(success)::int as success
      from responsible_buckets group by kind, id, email),
    daily as (select to_char(calendar.day, 'YYYY-MM-DD') as date, coalesce(c.leads, 0)::int as leads, coalesce(c.success, 0)::int as success
      from generate_series(${range.labels.from}::date, ${range.labels.to}::date, interval '1 day') calendar(day)
      left join (select day, count(*)::int as leads, count(*) filter(where closure = 'signal_working')::int as success from cohort group by day) c
        on c.day = to_char(calendar.day, 'YYYY-MM-DD')),
    page_rows as (select id, name, phone, status, "createdAt", result, "hasSavedResult",
      jsonb_build_object('kind', kind, 'source', source, 'medium', medium, 'campaign', campaign) as source,
      case when responsible_id is null then null else jsonb_build_object('id', responsible_id, 'email', responsible_email) end as responsible
      from cohort order by "createdAt" desc, id desc limit ${parsed.pageSize} offset ${offset})
    select (select jsonb_build_object('leads', count(*)::int, 'reviewed', count(*) filter(where qualification <> 'unreviewed')::int,
      'unreviewed', count(*) filter(where qualification = 'unreviewed')::int, 'suitable', count(*) filter(where qualification = 'suitable')::int,
      'unsuitable', count(*) filter(where qualification = 'unsuitable')::int, 'success', count(*) filter(where closure = 'signal_working')::int,
      'closed', count(*) filter(where closure <> 'open')::int, 'attributed', count(*) filter(where attributed)::int) from cohort) as totals,
      (select jsonb_build_object('unreviewed', count(*) filter(where qualification = 'unreviewed')::int,
        'suitable', count(*) filter(where qualification = 'suitable')::int, 'unsuitable', count(*) filter(where qualification = 'unsuitable')::int) from cohort) as qualifications,
      (select jsonb_build_object('open', count(*) filter(where closure = 'open')::int,
        'signal_working', count(*) filter(where closure = 'signal_working')::int, 'not_suitable', count(*) filter(where closure = 'not_suitable')::int,
        'candidate_declined', count(*) filter(where closure = 'candidate_declined')::int, 'no_contact', count(*) filter(where closure = 'no_contact')::int) from cohort) as closures,
      (select coalesce(jsonb_agg(to_jsonb(daily) order by date), '[]'::jsonb) from daily) as daily,
      (select coalesce(jsonb_agg(to_jsonb(sources) order by (kind = 'other'), leads desc, kind, source, medium, campaign), '[]'::jsonb) from sources) as sources,
      (select coalesce(jsonb_agg(to_jsonb(source_options) order by kind, source, medium, campaign), '[]'::jsonb) from source_options) as "sourceOptions",
      (select coalesce(jsonb_agg(to_jsonb(responsibles) order by (kind = 'other'), leads desc, kind, admin::text), '[]'::jsonb) from responsibles) as responsibles,
      (select coalesce(jsonb_agg(to_jsonb(losses) order by leads desc, reason nulls first), '[]'::jsonb)
        from (select reason, count(*)::int as leads from cohort where closure not in ('open', 'signal_working') group by reason) losses) as "lossReasons",
      ${adminsJson} as "responsibleAdmins",
      (select coalesce(jsonb_agg(to_jsonb(page_rows) order by "createdAt" desc, id desc), '[]'::jsonb) from page_rows) as items
  `);
  type Row = Pick<LeadResultsReport, "totals" | "qualifications" | "closures" | "daily" | "responsibles" | "lossReasons" | "responsibleAdmins"> & {
    sources: Omit<LeadResultsReport["sources"][number], "key">[]; sourceOptions: LeadResultsSource[]; items: LeadResultsReport["leads"]["items"];
  };
  const row = (response as unknown as { rows: Row[] }).rows[0];
  const sourceOptions = row.sourceOptions.map(s => ({ ...s, key: sourceKey(s)! }));
  // Keep a selected rare source representable even when it falls outside the bounded options.
  if (parsed.source !== "all" && !sourceOptions.some(option => option.key === parsed.source)) {
    const [kind, source, medium, campaign] = JSON.parse(parsed.source) as [Exclude<LeadResultsSource["kind"], "other">, string | null, string | null, string | null];
    if (sourceOptions.length >= leadResultsConfig.maxGroups) sourceOptions.pop();
    sourceOptions.push({ kind, source, medium, campaign, key: parsed.source });
  }
  return {
    range: range.labels, generatedAt: now.toISOString(), filters: { source: parsed.source, responsible: parsed.responsible },
    totals: row.totals, rates: { suitableOfReviewed: row.totals.reviewed ? row.totals.suitable / row.totals.reviewed : null,
      successOfAll: row.totals.leads ? row.totals.success / row.totals.leads : null },
    qualifications: row.qualifications, closures: row.closures, daily: row.daily,
    sources: row.sources.map(s => ({ ...s, key: sourceKey(s) })), sourceOptions, responsibles: row.responsibles,
    lossReasons: row.lossReasons, responsibleAdmins: row.responsibleAdmins,
    leads: { items: row.items.map(item => ({ ...item, createdAt: new Date(item.createdAt).toISOString(), result: canonicalState(item.result) })),
      total: row.totals.leads, page: parsed.page, pageSize: parsed.pageSize, pages: Math.ceil(row.totals.leads / parsed.pageSize) },
  };
}

/** Drizzle errors contain SQL parameters (private comments/contact data); log only the fixed operation name. */
function operation<A extends unknown[], R>(name: string, run: (...args: A) => Promise<R>) {
  return async (...args: A): Promise<R> => {
    try { return await run(...args); }
    catch (error) {
      unstable_rethrow(error);
      if (error instanceof AppError || error instanceof ZodError) throw error;
      console.warn(`lead_results.${name}_failed`);
      throw new AppError(500, "lead_results_failed", "Could not save or load lead results. Try again.");
    }
  };
}
export const getLeadResult = operation("detail", getLeadResultImpl);
export const updateLeadResult = operation("update", updateLeadResultImpl);
export const getLeadResults = operation("report", getLeadResultsImpl);
