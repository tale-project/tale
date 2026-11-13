import { describe, expect, test } from 'bun:test';

import type { IncusClient } from './client.ts';
import { getVolumeUsage } from './volumes.ts';

/** The part of a client the read uses, answering the volume state request
 * with `answer`. */
function answering(answer: unknown): Pick<IncusClient, 'project' | 'sync'> {
  return { project: 'tale', sync: async () => answer };
}

/** The error a promise rejects with; fails the test when it resolves. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

describe('a volume’s usage', () => {
  test('is what Incus answers, its quota or 0', async () => {
    expect(
      await getVolumeUsage(
        answering({ usage: { used: 4096, total: 8192 } }),
        'tank',
        'db-data',
      ),
    ).toEqual({ used: 4096, total: 8192 });
  });

  test('is 0 where Incus leaves a zero `used` out (a fresh copy of a snapshot on ZFS)', async () => {
    expect(
      await getVolumeUsage(
        answering({ usage: { total: 0 } }),
        'tank',
        'config-data',
      ),
    ).toEqual({ used: 0, total: 0 });
  });

  test('is refused, with the answer, where Incus names no usage at all', async () => {
    expect(
      (
        await rejection(
          getVolumeUsage(answering({ usage: null }), 'tank', 'db-data'),
        )
      ).message,
    ).toBe(
      'Incus answered the state of volume db-data without its usage: {"usage":null}',
    );
    expect(
      (
        await rejection(
          getVolumeUsage(answering({ usage: { used: -1 } }), 'tank', 'db-data'),
        )
      ).message,
    ).toContain('without its usage');
  });
});
