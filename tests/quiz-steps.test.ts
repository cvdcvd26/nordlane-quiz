import { describe, expect, it } from "vitest";
import { latestQuizStep, QUIZ_STEP_PATHS, resolveQuizStep, type QuizProgress } from "@/lib/quiz-steps";

const fresh: QuizProgress = { contactSaved: false, questionsComplete: false, submitted: false };
const contacted: QuizProgress = { ...fresh, contactSaved: true };
const answered: QuizProgress = { ...contacted, questionsComplete: true };
const submitted: QuizProgress = { ...answered, submitted: true };

describe("visitor step URLs", () => {
  it("resumes the latest saved step on a fresh visit to the home page", () => {
    expect([fresh, contacted, answered, submitted].map((progress) => latestQuizStep(progress))).toEqual([0, 1, 2, 3]);
    expect([fresh, contacted, answered, submitted].map((progress) => resolveQuizStep("/", progress))).toEqual([0, 1, 2, 3]);
  });

  it("prevents direct future links from skipping contact, questions, or submission", () => {
    for (const path of QUIZ_STEP_PATHS) {
      expect(resolveQuizStep(path, fresh)).toBe(0);
    }
    expect(resolveQuizStep("/step-3-task", contacted)).toBe(1);
    expect(resolveQuizStep("/step-4-confirmation", contacted)).toBe(1);
    expect(resolveQuizStep("/step-4-confirmation", answered)).toBe(2);
  });

  it("honors already available direct links when editing an unfinished application", () => {
    expect(resolveQuizStep("/step-2", answered)).toBe(1);
    expect(resolveQuizStep("/step-3-task", answered)).toBe(2);
    expect(resolveQuizStep("/step-2/", answered)).toBe(1);
  });

  it("keeps the contact form reachable by browser Back and refresh", () => {
    expect(resolveQuizStep("/", contacted, 0)).toBe(0);
    expect(resolveQuizStep("/", answered, 0)).toBe(0);
    // Stale or unrelated history state cannot skip the requirements.
    expect(resolveQuizStep("/", contacted, 3)).toBe(1);
    expect(resolveQuizStep("/step-3-task", fresh, 2)).toBe(0);
  });

  it("always shows the saved confirmation after submission, including old history entries", () => {
    for (const path of QUIZ_STEP_PATHS) {
      expect(resolveQuizStep(path, submitted)).toBe(3);
      expect(resolveQuizStep(path, submitted, 0)).toBe(3);
    }
    expect(resolveQuizStep("/", { ...fresh, submitted: true }, 0)).toBe(3);
  });
});
