"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { updateMetaQuizStage } from "@/lib/meta-pixel";
import type { QuizStep } from "@/lib/quiz-steps";

export function MetaQuizPixel({ scope, step, contactSaved, questionsComplete, submitted, restoredThrough = -1 }: {
  scope: string | null; step: QuizStep; contactSaved: boolean; questionsComplete: boolean; submitted: boolean;
  restoredThrough?: number;
}) {
  const pathname = usePathname();
  useEffect(() => {
    updateMetaQuizStage(scope ? { scope, step, progress: { contactSaved, questionsComplete, submitted }, restoredThrough } : null);
    return () => updateMetaQuizStage(null);
  }, [scope, step, contactSaved, questionsComplete, submitted, pathname, restoredThrough]);
  return null;
}
