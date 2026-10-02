import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import { sandboxCapacityRefusal } from './capacity_refusal';
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
