/**
 * Pure batch-apply logic for a job's progress checklist — extracted from the
 * `applyProgressOperations` mutation so the invariants (duplicate-add,
 * unknown-item, ordering, active-item derivation) unit-test without a DB.
 */

export interface JobProgressItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled';
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export type JobProgressOperation =
  | { type: 'add'; id: string; content: string }
  | {
      type: 'update';
      id: string;
      content?: string;
      status?: JobProgressItem['status'];
      note?: string;
    }
  | { type: 'remove'; id: string };

export type ApplyJobProgressResult =
  | {
      success: true;
      progress: JobProgressItem[];
      activeProgressId?: string;
    }
  | {
      success: false;
      error: string;
      code: 'unknown_item' | 'duplicate_add' | 'invalid_batch';
    };

export function applyJobProgressOps(
  existing: readonly JobProgressItem[],
  operations: readonly JobProgressOperation[],
  now: number,
): ApplyJobProgressResult {
  if (operations.length === 0) {
    return {
      success: false,
      error: 'operations array must be non-empty',
      code: 'invalid_batch',
    };
  }

  const items = new Map<string, JobProgressItem>(
    existing.map((item) => [item.id, item]),
  );
  for (const op of operations) {
    if (op.type === 'add') {
      if (items.has(op.id)) {
        return {
          success: false,
          error: `progress item "${op.id}" already exists`,
          code: 'duplicate_add',
        };
      }
      items.set(op.id, {
        id: op.id,
        content: op.content,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      });
    } else if (op.type === 'update') {
      const current = items.get(op.id);
      if (!current) {
        return {
          success: false,
          error: `progress item "${op.id}" not found`,
          code: 'unknown_item',
        };
      }
      items.set(op.id, {
        ...current,
        content: op.content ?? current.content,
        status: op.status ?? current.status,
        note: op.note ?? current.note,
        updatedAt: now,
      });
    } else {
      items.delete(op.id);
    }
  }

  const progress = Array.from(items.values()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  const activeProgressId = progress.find(
    (item) => item.status === 'in_progress',
  )?.id;

  return { success: true, progress, activeProgressId };
}

export const OP_ID_RING_BUFFER_SIZE = 256;

/** Append `opId` to the dedup ring, dropping the oldest past the cap. */
export function trimOpIdRing(
  buffer: readonly string[],
  opId: string,
): string[] {
  const filtered = buffer.filter((id) => id !== opId);
  filtered.push(opId);
  return filtered.length <= OP_ID_RING_BUFFER_SIZE
    ? filtered
    : filtered.slice(filtered.length - OP_ID_RING_BUFFER_SIZE);
}
