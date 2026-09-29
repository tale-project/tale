// @vitest-environment node

/**
 * The one way a set of refs goes to the durable release job: in jobs of a
 * bounded size, on the handle the caller hands in — the mail lanes' own
 * transaction, or the corpus reconcile's pool. A mail lane's failed enqueue
 * fails its transaction; the reconcile logs one and queues the rest.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx } = vi.hoisted(() => ({
  addJobInTx: vi.fn(
    async (_tx: unknown, _name: string, _payload: unknown) => 'job-1',
  ),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));

import { queueRefRelease, RELEASE_REFS_PER_JOB } from './release-queue.ts';

const ORG = 'org-1';
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handle is only passed through to the enqueue
const tx = {} as Sql;

const refsOf = (count: number) =>
  Array.from(
    { length: count },
    (_, at) => `s3:org-1/f${String(at).padStart(4, '0')}.pdf`,
  );

/** The refs of each job queued, in order. */
const jobs = () =>
  addJobInTx.mock.calls.map(
    ([, , payload]) => (payload as { refs: string[] }).refs,
  );

beforeEach(() => {
  addJobInTx.mockReset();
  addJobInTx.mockResolvedValue('job-1');
});

describe('queueRefRelease', () => {
  it('queues the refs in jobs of at most RELEASE_REFS_PER_JOB, in order, on the handle it was given', async () => {
    const refs = refsOf(2 * RELEASE_REFS_PER_JOB + 1);
    await queueRefRelease(tx, ORG, refs);
    expect(jobs().map((job) => job.length)).toEqual([
      RELEASE_REFS_PER_JOB,
      RELEASE_REFS_PER_JOB,
      1,
    ]);
    expect(jobs().flat()).toEqual(refs);
    for (const [handle, name, payload] of addJobInTx.mock.calls) {
      expect(handle).toBe(tx);
      expect(name).toBe('knowledge.release_refs');
      expect(payload).toEqual({ organizationId: ORG, refs: expect.any(Array) });
    }
  });

  it('queues one job for a full one, and none for no ref', async () => {
    await queueRefRelease(tx, ORG, refsOf(RELEASE_REFS_PER_JOB));
    expect(jobs().map((job) => job.length)).toEqual([RELEASE_REFS_PER_JOB]);
    addJobInTx.mockClear();
    await queueRefRelease(tx, ORG, []);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('throws a failed enqueue on, queueing no job after it, for the caller to roll back', async () => {
    const down = new Error('queue down');
    addJobInTx.mockRejectedValueOnce(down);
    await expect(
      queueRefRelease(tx, ORG, refsOf(RELEASE_REFS_PER_JOB + 1)),
    ).rejects.toBe(down);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('hands a failed job to onChunkError, and still queues the next', async () => {
    const down = new Error('queue down');
    addJobInTx.mockRejectedValueOnce(down);
    const refs = refsOf(RELEASE_REFS_PER_JOB + 1);
    const onChunkError = vi.fn();
    await queueRefRelease(tx, ORG, refs, { onChunkError });
    expect(onChunkError.mock.calls).toEqual([
      [refs.slice(0, RELEASE_REFS_PER_JOB), down],
    ]);
    expect(jobs()).toEqual([
      refs.slice(0, RELEASE_REFS_PER_JOB),
      refs.slice(RELEASE_REFS_PER_JOB),
    ]);
  });
});
