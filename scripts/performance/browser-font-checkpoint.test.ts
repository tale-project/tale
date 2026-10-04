import { expect, test } from 'bun:test';

import { acceptancePlan } from './browser/acceptance-plan.ts';
import { recordAcceptanceAction } from './browser/acceptance-record.ts';
import {
  fontCheckpoint,
  type FontCheckpoint,
} from './browser/font-checkpoint.ts';
import type { FontEvidence } from './browser/font-evidence.ts';

function evidence(status = 'error'): FontEvidence {
  return {
    capturedAt: 10,
    timeOrigin: 1,
    performanceNow: 9,
    ready: true,
    complete: true,
    overflow: false,
    errors: [],
    faces: [
      {
        family: 'Inter Fallback',
        style: 'normal',
        weight: 'normal',
        stretch: 'normal',
        unicodeRange: 'U+0-10FFFF',
        display: 'auto',
        status,
      },
    ],
    rules: [
      {
        href: null,
        family: 'Inter Fallback',
        style: 'normal',
        weight: 'normal',
        unicodeRange: '',
        src: 'local(Arial)',
      },
    ],
    responses: [],
    failedRequests: [],
  };
}

test('a font error persists its identity and browser errors before aborting', async () => {
  const order: string[] = [];
  let retained: FontCheckpoint | undefined;
  let written: FontCheckpoint | undefined;
  await expect(
    fontCheckpoint({
      collect: async () => {
        order.push('collect');
        return evidence();
      },
      errors: () => ['OTS decoding error'],
      retain: (value) => {
        order.push('retain');
        retained = value;
      },
      persist: async (value) => {
        order.push('persist');
        written = structuredClone(value);
      },
    }),
  ).rejects.toThrow('A font failed to load');
  expect(order).toEqual(['collect', 'retain', 'persist']);
  expect(written).toEqual(retained);
  expect(written?.fonts?.faces[0]).toMatchObject({
    family: 'Inter Fallback',
    status: 'error',
  });
  expect(written?.fonts?.rules[0]?.src).toBe('local(Arial)');
  expect(written?.errors).toEqual(['OTS decoding error']);
});

test('a write failure cannot replace the original font error or erase its cached identity', async () => {
  let retained: FontCheckpoint | undefined;
  let caught: unknown;
  try {
    await fontCheckpoint({
      collect: async () => evidence(),
      errors: () => [],
      retain: (value) => {
        retained = value;
      },
      persist: async () => {
        throw new Error('disk full');
      },
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect(String(caught)).toContain('A font failed to load');
  expect(String(caught)).toContain('disk full');
  expect(retained?.persistenceError).toBe('Error: disk full');
  expect(retained?.fonts?.faces[0]?.status).toBe('error');
});

test('a failed standalone startup write preserves identity and write error in the recoverable campaign receipt', async () => {
  const campaign: {
    startupFonts?: { evidence: FontCheckpoint };
    error?: string;
  } = {};
  let writes = 0;
  try {
    await fontCheckpoint({
      collect: async () => evidence(),
      errors: () => ['font console error'],
      retain: () => {},
      persist: async (value) => {
        campaign.startupFonts = { evidence: value };
        writes += 1;
        throw new Error('startup file write failed');
      },
    });
  } catch (error) {
    campaign.error = String(error);
  }
  // Models the outer save after the browser/session has been closed.
  const saved = JSON.parse(JSON.stringify(campaign)) as typeof campaign;
  expect(writes).toBe(1);
  expect(saved.error).toContain('A font failed to load');
  expect(saved.error).toContain('startup file write failed');
  expect(saved.startupFonts?.evidence.fonts?.faces[0]).toMatchObject({
    family: 'Inter Fallback',
    status: 'error',
  });
  expect(saved.startupFonts?.evidence.persistenceError).toBe(
    'Error: startup file write failed',
  );
  expect(saved.startupFonts?.evidence.errors).toEqual(['font console error']);
});

test('incomplete or unavailable collection is retained and never reported valid', async () => {
  for (const unavailable of [false, true]) {
    let written: FontCheckpoint | undefined;
    await expect(
      fontCheckpoint({
        collect: async () => {
          if (unavailable) throw new Error('page disconnected');
          return {
            ...evidence(),
            complete: false,
            errors: ['body read timed out'],
          };
        },
        errors: () => ['console failure'],
        retain: () => {},
        persist: async (value) => {
          written = value;
        },
      }),
    ).rejects.toThrow(
      unavailable ? 'page disconnected' : 'A font failed to load',
    );
    expect(written?.errors).toEqual(['console failure']);
    if (unavailable)
      expect(written?.collectionError).toBe('Error: page disconnected');
    else expect(written?.fonts?.errors).toEqual(['body read timed out']);
  }
});

test('loaded and unused faces preserve the original no-error rule without forced loading', async () => {
  for (const status of ['loaded', 'unloaded']) {
    const result = await fontCheckpoint({
      collect: async () => evidence(status),
      errors: () => [],
      retain: () => {},
      persist: async () => {},
    });
    expect(result.fonts?.faces[0]?.status).toBe(status);
    expect(result.validationErrors).toEqual([]);
  }
});

test('row timing and heap precede font diagnostics; failed validity retains exactly one invalid row', async () => {
  const order: string[] = [];
  const rows: Record<string, unknown>[] = [];
  let retained: FontCheckpoint | undefined;
  const planned = acceptancePlan[0]!.samples[0]!.operations[0]!;
  await expect(
    recordAcceptanceAction(planned, {
      now: () => 10,
      action: async () => {
        order.push('action');
        return { durationMs: 123 };
      },
      after: async () => {
        order.push('heap');
        await fontCheckpoint({
          collect: async () => {
            order.push('fonts');
            return evidence();
          },
          errors: () => ['font console error'],
          retain: (value) => {
            retained = value;
          },
          persist: async () => {},
        });
        return { heapMiB: 100 };
      },
      failureEvidence: async () => ({ ...retained }),
      checkpoint: async () => {},
      append: async (row) => {
        rows.push(row);
      },
    }),
  ).rejects.toThrow('A font failed to load');
  expect(order).toEqual(['action', 'heap', 'fonts']);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    durationMs: 123,
    valid: false,
    complete: false,
    failureEvidence: {
      errors: ['font console error'],
      fonts: { faces: [{ family: 'Inter Fallback', status: 'error' }] },
    },
  });
});
