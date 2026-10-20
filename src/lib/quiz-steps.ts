export const QUIZ_STEP_PATHS = ["/", "/step-2", "/step-3-task", "/step-4-confirmation"] as const;

export type QuizStep = 0 | 1 | 2 | 3;

export type QuizProgress = {
  contactSaved: boolean;
  questionsComplete: boolean;
  submitted: boolean;
};

/** Only a non-sensitive step number is kept in history; visitor access stays in the session cookie. */
export const QUIZ_HISTORY_STEP = "alleybizQuizStep";

export function latestQuizStep(progress: QuizProgress): QuizStep {
  if (progress.submitted) return 3;
  if (!progress.contactSaved) return 0;
  return progress.questionsComplete ? 2 : 1;
}

/**
 * Direct links can revisit saved steps, but cannot skip unfinished requirements.
 * A fresh visit to / resumes progress. A history entry explicitly opened for the
 * contact form stays there on Back/Forward and reload, so it can still be edited.
 */
export function resolveQuizStep(pathname: string, progress: QuizProgress, historyStep?: unknown): QuizStep {
  const latest = latestQuizStep(progress);
  if (latest === 3) return 3;

  const normalized = pathname.replace(/\/+$/, "") || "/";
  const requested = QUIZ_STEP_PATHS.findIndex((path) => path === normalized);
  if (requested === 0) return historyStep === 0 ? 0 : latest;
  if (requested === -1) return latest;
  return Math.min(requested, latest) as QuizStep;
}
