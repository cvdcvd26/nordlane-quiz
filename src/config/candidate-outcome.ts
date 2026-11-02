/** The public result is separate from the team's internal lead status. */
export const candidateOutcomeConfig = {
  title: "Wynik rozpatrzenia zgłoszenia",
  defaultBody: "Dziękujemy za zgłoszenie i poświęcony czas. Po jego rozpatrzeniu zdecydowaliśmy, że nie będziemy kontynuować rekrutacji na to stanowisko.",
  maxBodyLength: 3000,
} as const;

export type CandidateOutcome = {
  status: "rejected";
  title: string;
  body: string;
  publishedAt: string;
};
