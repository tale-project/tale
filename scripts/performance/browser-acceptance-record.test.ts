import { expect, test } from 'bun:test';

import { acceptancePlan } from './browser/acceptance-plan.ts';
import { recordAcceptanceAction } from './browser/acceptance-record.ts';

const planned = acceptancePlan[0]!.samples[0]!.operations[0]!;
test('successful action facts survive a later validity failure and are appended once', async () => {
  const checkpoints: unknown[] = [];
  const rows: Record<string, unknown>[] = [];
  await expect(
    recordAcceptanceAction(planned, {
      now: () => 100,
      action: async () => ({ durationMs: 900, frame: { tFrame: 900 } }),
      after: async () => {
        throw new Error('OOM');
      },
      checkpoint: async (row) => {
        checkpoints.push(structuredClone(row));
      },
      append: async (row) => {
        rows.push(structuredClone(row));
      },
    }),
  ).rejects.toThrow('OOM');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    durationMs: 900,
    complete: false,
    valid: false,
    error: 'Error: OOM',
    frame: { tFrame: 900 },
  });
  expect(checkpoints).toHaveLength(3);
});
test('valid slow rows remain complete instead of throwing or replacing a sample', async () => {
  const rows: unknown[] = [];
  const result = await recordAcceptanceAction(planned, {
    now: () => 1,
    action: async () => ({ durationMs: 110_000 }),
    after: async () => ({ heapMiB: 700 }),
    checkpoint: async () => {},
    append: async (row) => {
      rows.push(row);
    },
  });
  expect(result).toMatchObject({
    durationMs: 110_000,
    heapMiB: 700,
    complete: true,
    valid: true,
  });
  expect(rows).toHaveLength(1);
});
test('failed evidence checkpoint preserves original write error and no fake successful row', async () => {
  let count = 0;
  const rows: Record<string, unknown>[] = [];
  await expect(
    recordAcceptanceAction(planned, {
      now: () => 1,
      action: async () => ({ durationMs: 5 }),
      after: async () => ({ heapMiB: 1 }),
      checkpoint: async () => {
        if (++count > 1) throw new Error('disk-full');
      },
      append: async (row) => {
        rows.push(row);
      },
    }),
  ).rejects.toThrow('disk-full');
  expect(rows[0]).toMatchObject({
    durationMs: 5,
    complete: false,
    error: 'Error: disk-full',
    checkpointError: 'Error: disk-full',
  });
});

test('failed preparation retains an invalid planned row without executing or replacing the action', async () => {
  let actions = 0;
  const rows: Record<string, unknown>[] = [];
  await expect(
    recordAcceptanceAction(planned, {
      now: () => 1,
      prepare: async () => {
        throw new Error('Wrong general precondition');
      },
      action: async () => {
        actions += 1;
        return { durationMs: 5 };
      },
      after: async () => ({ heapMiB: 1 }),
      checkpoint: async () => {},
      append: async (row) => {
        rows.push(structuredClone(row));
      },
    }),
  ).rejects.toThrow('Wrong general precondition');
  expect(actions).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: planned.id,
    complete: false,
    valid: false,
  });
});

test('partial browser evidence is kept after action failure and cannot mask the original error', async () => {
  for (const evidenceFails of [false, true]) {
    const rows: Record<string, unknown>[] = [];
    await expect(
      recordAcceptanceAction(planned, {
        now: () => 1,
        action: async () => {
          throw new Error('original action failure');
        },
        after: async () => ({ heapMiB: 1 }),
        failureEvidence: async () => {
          if (evidenceFails) throw new Error('browser unavailable');
          return { animation: 'partial' };
        },
        checkpoint: async () => {},
        append: async (row) => {
          rows.push(row);
        },
      }),
    ).rejects.toThrow('original action failure');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toContain('original action failure');
    if (evidenceFails)
      expect(rows[0]!.failureEvidenceError).toContain('browser unavailable');
    else expect(rows[0]!.failureEvidence).toEqual({ animation: 'partial' });
  }
});
