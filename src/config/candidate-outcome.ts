/** The public result is separate from the team's internal lead status. */
export const candidateOutcomeConfig = {
  title: "Wynik rozpatrzenia zgłoszenia",
  defaultBody: "Dziękujemy za wykonanie zadania i poświęcony czas. Po rozpatrzeniu zgłoszenia zdecydowaliśmy, że nie będziemy kontynuować rekrutacji na to stanowisko.",
  maxBodyLength: 3000,
} as const;

export type CandidateOutcome = {
  status: "rejected";
  title: string;
  body: string;
  publishedAt: string;
};
