/** Public measurement ID, not an API credential. Preview/local traffic is excluded. */
export const metaPixelConfig = {
  id: "1823278402432437",
  hosts: ["alleybiz.vercel.app"],
  events: ["LandingView", "ContactCompleted", "QuizCompleted", "TaskSubmitted"],
} as const;
