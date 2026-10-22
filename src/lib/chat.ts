export type OrderedMessage = { id: string; createdAt: string; sequence?: string; changeRevision?: number };

/** Sequence is assigned under the visitor lock; timestamps are display data only. */
export function mergeMessages<T extends OrderedMessage>(previous: T[], incoming: T[]): T[] {
  const messages = new Map(previous.map((m) => [m.id, m]));
  incoming.forEach((m) => {
    if ((messages.get(m.id)?.changeRevision ?? 0) <= (m.changeRevision ?? 0)) messages.set(m.id, m);
  });
  return [...messages.values()].sort((a, b) => {
    if (a.sequence && b.sequence) return BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Remember changes for in-flight history pages, including messages not loaded yet. */
export function rememberMessageChanges<T extends OrderedMessage>(known: Map<string, T | null>, updates: T[], deletedIds: string[]) {
  for (const message of updates) {
    const previous = known.get(message.id);
    if (previous !== null && (previous?.changeRevision ?? 0) <= (message.changeRevision ?? 0)) known.set(message.id, message);
  }
  deletedIds.forEach(id => known.set(id, null));
}

export function reconcileMessageChanges<T extends OrderedMessage>(messages: T[], changes: Map<string, T | null>): T[] {
  return messages.flatMap(message => {
    const change = changes.get(message.id);
    if (change === null) return [];
    return [change && (change.changeRevision ?? 0) >= (message.changeRevision ?? 0) ? change : message];
  });
}
