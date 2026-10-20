import { QuizApp } from "@/components/visitor/QuizApp";

/** A persistent shell keeps in-memory drafts intact across the four step URLs. */
export default function QuizLayout({ children }: { children: React.ReactNode }) {
  return <><QuizApp />{children}</>;
}
