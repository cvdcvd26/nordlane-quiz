export type ManagerProfile = { id: string; name: string; avatar: string };

/** The initial HR profiles seeded by the database migration. */
export const managerProfiles: readonly ManagerProfile[] = [
  { id: "aneta", name: "Aneta (HR)", avatar: "/aneta-hr.png" },
  { id: "maja", name: "Maja (HR)", avatar: "/maja-hr.png" },
  { id: "hanna", name: "Hanna (HR)", avatar: "/hanna-hr.png" },
  { id: "agnieszka", name: "Agnieszka (HR)", avatar: "/agnieszka-hr.png" },
];

export const defaultManager = managerProfiles[0];
