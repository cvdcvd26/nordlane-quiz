import type { AnalyticsPeriod } from "./analytics";

export const leadQualifications = ["unreviewed", "suitable", "unsuitable"] as const;
export const leadClosures = ["open", "data_received", "signal_working", "not_suitable", "candidate_declined", "no_contact"] as const;
export const leadResultReasons = ["task", "skills", "conditions", "schedule", "communication", "candidate_choice", "other"] as const;
export const leadResultsConfig = { commentLimit: 2000, pageSize: 25, maxPageSize: 100, maxGroups: 30, historyLimit: 10 } as const;

export type LeadQualification = typeof leadQualifications[number];
export type LeadClosure = typeof leadClosures[number];
export type LeadResultReason = typeof leadResultReasons[number];
export type LeadResponsibleAdmin = { id: string; email: string };
export type LeadResultState = {
  qualification: LeadQualification;
  closure: LeadClosure;
  reason: LeadResultReason | null;
  comment: string;
  responsibleAdminId: string | null;
  updatedById: string | null;
  version: number;
  updatedAt: string | null;
  closedAt: string | null;
};
export type LeadResultUpdate = Pick<LeadResultState, "qualification" | "closure" | "reason" | "comment" | "responsibleAdminId"> & { expectedVersion: number };
export type LeadResultHistoryEntry = {
  id: string;
  previous: LeadResultState;
  next: LeadResultState;
  actor: LeadResponsibleAdmin | null;
  createdAt: string;
};
export type LeadResultDetail = {
  leadId: number;
  hasSavedResult: boolean;
  result: LeadResultState;
  history: LeadResultHistoryEntry[];
  responsibleAdmins: LeadResponsibleAdmin[];
};
export type LeadResultsSource = {
  kind: "utm" | "referrer" | "direct" | "unknown" | "other";
  source: string | null;
  medium: string | null;
  campaign: string | null;
};
export type LeadResultsCounts = { leads: number; reviewed: number; suitable: number; success: number };
export type LeadResultListItem = {
  id: number;
  name: string | null;
  phone: string | null;
  status: "new" | "in_progress" | "awaiting_reply" | "completed" | "rejected";
  createdAt: string;
  result: LeadResultState;
  hasSavedResult: boolean;
  source: LeadResultsSource;
  responsible: LeadResponsibleAdmin | null;
};
/** source is "all" or the opaque key returned by a source row; responsible is "all", "unassigned", or an admin UUID. */
export type LeadResultsQuery = {
  period?: AnalyticsPeriod;
  from?: string;
  to?: string;
  source?: string;
  responsible?: string;
  page?: string;
  pageSize?: string;
};
export type LeadResultsReport = {
  range: { from: string; to: string; timezone: "Europe/Warsaw" };
  generatedAt: string;
  filters: { source: string; responsible: string };
  totals: LeadResultsCounts & { unreviewed: number; unsuitable: number; closed: number; attributed: number };
  /** Ratios in [0,1], null when their explicitly named denominator is zero. */
  rates: { suitableOfReviewed: number | null; successOfAll: number | null };
  qualifications: Record<LeadQualification, number>;
  closures: Record<LeadClosure, number>;
  daily: { date: string; leads: number; success: number }[];
  /** At most maxGroups rows; final "other" bucket is not an individual filter option (key=null). */
  sources: (LeadResultsSource & LeadResultsCounts & { key: string | null })[];
  /** Date/responsible cohort options are independent of the active source filter. */
  sourceOptions: (LeadResultsSource & { key: string })[];
  responsibles: (LeadResultsCounts & { kind: "admin" | "unassigned" | "other"; admin: LeadResponsibleAdmin | null })[];
  lossReasons: { reason: LeadResultReason | null; leads: number }[];
  responsibleAdmins: LeadResponsibleAdmin[];
  leads: { items: LeadResultListItem[]; total: number; page: number; pageSize: number; pages: number };
};

/** Current successful results within the applied lead-created cohort, independently paginated. */
export type LeadResultsSuccessList = Pick<LeadResultsReport, "range" | "generatedAt" | "filters" | "leads">;
