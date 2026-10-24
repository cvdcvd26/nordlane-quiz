import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { analyticsConfig, type AnalyticsReport } from "@/config/analytics";
import { content } from "@/config/content";
import { toWarsawInput, warsawTimeCandidates } from "@/lib/reminders";
import { badRequest } from "../errors";

const DAY = 86_400_000;
const rangeInput = z.object({
  period: z.enum(["7d", "30d", "90d", "custom"]).optional().default("30d"),
  from: z.string().optional(), to: z.string().optional(),
}).strict();
const invalidRange = () => badRequest("Choose a valid Warsaw calendar date range of up to 366 days.", "analytics_range");

function dateOnly(value: string | undefined) {
  if (!value || !/^(20\d{2}|2100)-\d{2}-\d{2}$/.test(value)) throw invalidRange();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.toISOString().slice(0, 10) !== value) throw invalidRange();
  return date;
}

function startOfWarsawDay(day: Date) {
  const [instant] = warsawTimeCandidates(`${day.toISOString().slice(0, 10)}T00:00`);
  if (!instant) throw invalidRange();
  return new Date(instant);
}

/** Count calendar days independently of DST, then resolve each Warsaw midnight to a UTC instant. */
export function parseAnalyticsRange(input: Record<string, string | undefined>, now = new Date()) {
  const parsed = rangeInput.safeParse(input);
  if (!parsed.success) throw invalidRange();
  const p = parsed.data;
  // These Date values are calendar ordinals for arithmetic, not the SQL instants.
  const today = dateOnly(toWarsawInput(now).slice(0, 10));
  const to = p.period === "custom" ? dateOnly(p.to) : today;
  const days = p.period === "7d" ? 7 : p.period === "90d" ? 90 : 30;
  const from = p.period === "custom" ? dateOnly(p.from) : new Date(to.getTime() - (days - 1) * DAY);
  const end = new Date(to.getTime() + DAY);
  if (from > to || to > today || end.getTime() - from.getTime() > analyticsConfig.maxRangeDays * DAY) throw invalidRange();
  return {
    from: startOfWarsawDay(from), end: startOfWarsawDay(end),
    labels: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), timezone: analyticsConfig.timeZone },
  };
}

export async function getAnalytics(input: Record<string, string | undefined>, now = new Date()): Promise<AnalyticsReport> {
  const range = parseAnalyticsRange(input, now);
  const validAnswers = sql.join(content.quiz.questions.map(question => sql`(qa.question_key = ${question.key}
    and qa.answer in (${sql.join(question.options.map(option => sql`${option.value}`), sql`, `)}))`), sql` or `);
  // One statement provides a consistent snapshot for totals and every source denominator.
  // Each relation is tested with EXISTS / a scalar count, preventing answer/file joins from multiplying sessions.
  const result = await db().execute(sql`
    with cohort as (
      select s.id, s.last_seen_at,
        exists(select 1 from visitor_contacts vc where vc.session_id = s.id) as has_contact,
        (select count(distinct qa.question_key) from quiz_answers qa where qa.session_id = s.id and (${validAnswers})) = ${content.quiz.questions.length} as has_answers,
        a.task_viewed_at is not null as task_viewed,
        exists(select 1 from task_submissions ts where ts.session_id = s.id) as submitted,
        coalesce(a.consent_all, false) as attributed,
        case when not coalesce(a.consent_all, false) then 'unknown'
          when coalesce(a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term) is not null then 'utm'
          when a.referrer_host is not null then 'referrer' else 'direct' end as kind,
        case when a.consent_all then coalesce(a.utm_source, a.referrer_host) end as source,
        case when a.consent_all then a.utm_medium end as medium,
        case when a.consent_all then a.utm_campaign end as campaign
      from visitor_sessions s left join visitor_attribution a on a.session_id = s.id
      where s.created_at >= ${range.from} and s.created_at < ${range.end}
    ), grouped as (
      select kind, source, medium, campaign, count(*)::int as sessions,
        count(*) filter(where has_contact)::int as contacts,
        count(*) filter(where has_contact and has_answers)::int as questions,
        count(*) filter(where task_viewed)::int as task_viewed,
        count(*) filter(where submitted)::int as submitted
      from cohort group by kind, source, medium, campaign
    ), ranked as (
      select *, row_number() over(order by sessions desc, kind, source nulls first, medium nulls first, campaign nulls first) as rank
      from grouped
    ), bucketed as (
      select case when rank < ${analyticsConfig.maxSourceGroups} then kind else 'other' end as kind,
        case when rank < ${analyticsConfig.maxSourceGroups} then source end as source,
        case when rank < ${analyticsConfig.maxSourceGroups} then medium end as medium,
        case when rank < ${analyticsConfig.maxSourceGroups} then campaign end as campaign,
        sessions, contacts, questions, task_viewed, submitted
      from ranked
    ), sources as (
      select kind, source, medium, campaign, sum(sessions)::int as sessions, sum(contacts)::int as contacts,
        sum(questions)::int as questions, sum(task_viewed)::int as "taskViewed", sum(submitted)::int as submitted
      from bucketed group by kind, source, medium, campaign
    )
    select (select jsonb_build_object(
      'sessions', count(*)::int, 'contacts', count(*) filter(where has_contact)::int,
      'questions', count(*) filter(where has_contact and has_answers)::int,
      'taskViewed', count(*) filter(where task_viewed)::int, 'submitted', count(*) filter(where submitted)::int,
      'attributed', count(*) filter(where attributed)::int,
      'active', count(*) filter(where last_seen_at >= ${new Date(now.getTime() - 120_000)})::int
    ) from cohort) as totals,
    (select coalesce(jsonb_agg(to_jsonb(sources) order by (kind = 'other'), sessions desc, kind, source, medium, campaign), '[]'::jsonb) from sources) as sources
  `);
  const rows = (result as unknown as { rows: { totals: AnalyticsReport["totals"]; sources: AnalyticsReport["sources"] }[] }).rows;
  return { range: range.labels, generatedAt: now.toISOString(), totals: rows[0].totals, sources: rows[0].sources };
}
