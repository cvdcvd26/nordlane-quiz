import { QuizApp } from "@/components/visitor/QuizApp";

/** Static shell: all visitor state is loaded on the client from /api/session. */
export default function Home() {
  return <QuizApp />;
}
