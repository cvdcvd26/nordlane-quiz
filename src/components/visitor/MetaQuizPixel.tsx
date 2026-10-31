"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { updateMetaQuizStage } from "@/lib/meta-pixel";
import type { QuizStep } from "@/lib/quiz-steps";

export function MetaQuizPixel({ scope, step, contactSaved, questionsComplete, submitted }: {
  scope: string | null; step: QuizStep; contactSaved: boolean; questionsComplete: boolean; submitted: boolean;
}) {
  const pathname = usePathname();
  useEffect(() => {
    updateMetaQuizStage(scope ? { scope, step, progress: { contactSaved, questionsComplete, submitted } } : null);
    return () => updateMetaQuizStage(null);
  }, [scope, step, contactSaved, questionsComplete, submitted, pathname]);
  return null;
}
