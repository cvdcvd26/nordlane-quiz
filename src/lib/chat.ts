export type OrderedMessage = { id: string; createdAt: string; sequence?: string };

/** Sequence is assigned under the visitor lock; timestamps are display data only. */
export function mergeMessages<T extends OrderedMessage>(previous: T[], incoming: T[]): T[] {
  const messages = new Map(previous.map((m) => [m.id, m]));
  incoming.forEach((m) => messages.set(m.id, m));
  return [...messages.values()].sort((a, b) => {
    if (a.sequence && b.sequence) return BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}
