/**
 * Coalesce a batch of outbox rows: keep only the LAST occurrence per
 * (entity, entityId), preserving ascending id order. One hot entity that
 * changed 50 times inside a poll window becomes one invalidation.
 */
export function coalesceHints<
  T extends { entity: string; entityId: string | null },
>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const reversed: T[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row === undefined) {
      continue;
    }
    const key = JSON.stringify([row.entity, row.entityId]);
    if (!seen.has(key)) {
      seen.add(key);
      reversed.push(row);
    }
  }
  return reversed.reverse();
}
