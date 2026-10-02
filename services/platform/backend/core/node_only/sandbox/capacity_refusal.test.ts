import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import { queuedWakeAfterMs, sandboxCapacityRefusal } from './capacity_refusal';
import { SpawnerBusyError } from './helpers/session_client';

describe('sandboxCapacityRefusal', () => {
  it('reads a busy sandbox host with its retry hint', () => {
    expect(sandboxCapacityRefusal(new SpawnerBusyError(30_000))).toEqual({
      scope: 'host',
      retryAfterMs: 30_000,
    });
    expect(sandboxCapacityRefusal(new SpawnerBusyError(undefined))).toEqual({
      scope: 'host',
      retryAfterMs: 15_000,
    });
  });

  it("carries the start's place in the spawner's line", () => {
    const refusal = sandboxCapacityRefusal(
      new SpawnerBusyError(45_000, { position: 4, waiting: 9 }),
    );
    expect(refusal).toStrictEqual({
      scope: 'host',
      retryAfterMs: 45_000,
      queue: { position: 4, waiting: 9 },
    });
    expect(
      sandboxCapacityRefusal(new SpawnerBusyError(45_000)),
    ).not.toHaveProperty('queue');
  });

  it('wakes a start at its place only when the host keeps a line', () => {
    const queued = sandboxCapacityRefusal(
      new SpawnerBusyError(35_000, { position: 6, waiting: 9 }),
    );
    const unqueued = sandboxCapacityRefusal(new SpawnerBusyError(10_000));
    const organization = sandboxCapacityRefusal(
      new AppError({ code: 'QUOTA_EXCEEDED', message: 'At most 2 sessions' }),
    );
    expect(queued && queuedWakeAfterMs(queued)).toBe(35_000);
    expect(unqueued && queuedWakeAfterMs(unqueued)).toBeUndefined();
    expect(organization && queuedWakeAfterMs(organization)).toBeUndefined();
  });

  it("reads the organization's spent session budget in every shape it arrives in", () => {
    const shapes = [
      new AppError({ code: 'QUOTA_EXCEEDED', message: 'At most 2 sessions' }),
      Object.assign(new Error('At most 2 workflow sandbox sessions'), {
        code: 'QUOTA_EXCEEDED',
      }),
      new Error('{"code":"QUOTA_EXCEEDED","message":"At most 2"}'),
    ];
    for (const shape of shapes) {
      expect(sandboxCapacityRefusal(shape)).toEqual({
        scope: 'organization',
        retryAfterMs: 15_000,
      });
    }
  });

  it('is null for every other failure', () => {
    expect(
      sandboxCapacityRefusal(new Error('runnerd did not become ready')),
    ).toBeNull();
    expect(sandboxCapacityRefusal('QUOTA')).toBeNull();
    expect(sandboxCapacityRefusal(undefined)).toBeNull();
  });
});
