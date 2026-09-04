/**
 * Folds an erasure receipt's per-category snapshot into the rows the
 * breakdown panel renders, plus a count of the categories that came back
 * empty.
 *
 * Two shapes reach this. A pass records a plain count. The older shape was an
 * object per category, and receipts written before that change still carry
 * it, so both are read. Reading only the object form is what rendered the
 * panel blank for every recent request: every entry was skipped before the
 * empty-category branch, so the panel showed neither rows nor the "no data in
 * N other categories" line.
 */

export interface BreakdownRow {
  key: string;
  rows: number;
  skippedByHold: number;
}

interface PerCategoryEntry {
  rows?: number;
  skippedByHold?: number;
  blobs?: number;
  attempts?: number;
  blockCounters?: number;
}

export function foldBreakdownEntries(snapshot: Record<string, unknown>): {
  visible: BreakdownRow[];
  zeroCount: number;
} {
  const visible: BreakdownRow[] = [];
  let zeroCount = 0;
  for (const [key, value] of Object.entries(snapshot)) {
    let rows: number;
    let skippedByHold = 0;
    if (typeof value === 'number') {
      rows = value;
    } else if (typeof value === 'object' && value !== null) {
      const entry = value as PerCategoryEntry;
      // `loginAttempts` reported {attempts, blockCounters} rather than {rows};
      // sum them into the same "rows" view.
      rows =
        typeof entry.rows === 'number'
          ? entry.rows
          : (entry.attempts ?? 0) + (entry.blockCounters ?? 0);
      skippedByHold = entry.skippedByHold ?? 0;
    } else {
      continue;
    }
    if (rows === 0 && skippedByHold === 0) {
      zeroCount++;
    } else {
      visible.push({ key, rows, skippedByHold });
    }
  }
  return { visible, zeroCount };
}
