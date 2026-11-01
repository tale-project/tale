import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import {
  SANDBOX_WORKSPACE_DESTROYED_CODE,
  SANDBOX_WORKSPACE_DESTROYED_MESSAGE,
} from '../../sandbox/run_workspace_destroy';
import { SANDBOX_DESTROY_PENDING_MESSAGE } from '../../sandbox/session_constants';
import * as released from './capacity_refusal';
import {
  SessionExecLimitError,
  SpawnerBusyError,
} from './helpers/session_client';
import {
  isDestroyPendingRefusal,
  isWorkspaceDestroyedRefusal,
  sandboxCapacityRefusal,
} from './start_refusal';

describe('sandboxCapacityRefusal', () => {
  it('reads a busy host and a full workspace as the released reader does', () => {
    const shapes = [
      new SpawnerBusyError(45_000, { position: 4, waiting: 9 }),
      new SpawnerBusyError(undefined),
      new SessionExecLimitError('pa-agent', 'exec-5'),
    ];
    for (const shape of shapes) {
      expect(sandboxCapacityRefusal(shape)).toStrictEqual(
        released.sandboxCapacityRefusal(shape),
      );
      expect(sandboxCapacityRefusal(shape)).not.toBeNull();
    }
  });

  it("reads the organization's spent session budget by its code [SBX-R8]", () => {
    const shapes = [
      new AppError({ code: 'QUOTA_EXCEEDED', message: 'At most 2 sessions' }),
      Object.assign(new Error('At most 2 workflow sandbox sessions'), {
        code: 'QUOTA_EXCEEDED',
      }),
    ];
    for (const shape of shapes) {
      expect(sandboxCapacityRefusal(shape)).toEqual({
        scope: 'organization',
        retryAfterMs: 15_000,
      });
      expect(isDestroyPendingRefusal(shape)).toBe(false);
    }
  });

  it('reads a pending Destroy by its code and reason, as no want of room [SBX-R9]', () => {
    const shapes = [
      new AppError({
        code: 'QUOTA_EXCEEDED',
        message: SANDBOX_DESTROY_PENDING_MESSAGE,
        reason: 'destroy_pending',
      }),
      Object.assign(new Error(SANDBOX_DESTROY_PENDING_MESSAGE), {
        code: 'QUOTA_EXCEEDED',
        reason: 'destroy_pending',
      }),
    ];
    for (const shape of shapes) {
      expect(sandboxCapacityRefusal(shape)).toBeNull();
      expect(isDestroyPendingRefusal(shape)).toBe(true);
    }
    expect(
      isDestroyPendingRefusal(
        new AppError({ code: 'NOT_FOUND', reason: 'destroy_pending' }),
      ),
    ).toBe(false);
  });

  it("reads a refusal by its code, never by an error's words (#4159)", () => {
    // A staging error quotes the paths it failed on, and people name the
    // files: words that look like a refusal made a failed step wait as if
    // the budget were spent, or blamed an administrator's Destroy. The
    // released reader, which the 0.5 flow keeps, still reads them.
    const quoting = [
      new Error(
        'staging input files failed: workspace/inbox/QUOTA_EXCEEDED.csv (too_large)',
      ),
      new Error(
        'staging input files failed: workspace/inbox/QUOTA_EXCEEDED "reason":"destroy_pending".txt (too_large)',
      ),
      new Error(
        `{"code":"QUOTA_EXCEEDED","message":"${SANDBOX_DESTROY_PENDING_MESSAGE}","reason":"destroy_pending"}`,
      ),
    ];
    for (const err of quoting) {
      expect(sandboxCapacityRefusal(err)).toBeNull();
      expect(isDestroyPendingRefusal(err)).toBe(false);
    }
    expect(released.sandboxCapacityRefusal(quoting[0])).not.toBeNull();
    expect(released.isDestroyPendingRefusal(quoting[2])).toBe(true);
  });

  it('is null for every other failure', () => {
    expect(
      sandboxCapacityRefusal(new Error('runnerd did not become ready')),
    ).toBeNull();
    expect(sandboxCapacityRefusal('QUOTA_EXCEEDED')).toBeNull();
    expect(sandboxCapacityRefusal(undefined)).toBeNull();
    expect(isDestroyPendingRefusal(new SpawnerBusyError(15_000))).toBe(false);
    expect(isDestroyPendingRefusal(undefined)).toBe(false);
  });
});

describe('isWorkspaceDestroyedRefusal', () => {
  it("reads a run's refusal for its deleted workspace by its code, as no want of room and no pending Destroy [SBX-R9]", () => {
    const refusal = Object.assign(
      new Error(SANDBOX_WORKSPACE_DESTROYED_MESSAGE),
      { code: SANDBOX_WORKSPACE_DESTROYED_CODE },
    );
    expect(isWorkspaceDestroyedRefusal(refusal)).toBe(true);
    expect(sandboxCapacityRefusal(refusal)).toBeNull();
    expect(isDestroyPendingRefusal(refusal)).toBe(false);
  });

  it('is false for every other failure, its words included', () => {
    const others: unknown[] = [
      new Error(SANDBOX_WORKSPACE_DESTROYED_MESSAGE),
      new Error(SANDBOX_WORKSPACE_DESTROYED_CODE),
      new AppError({
        code: 'QUOTA_EXCEEDED',
        message: SANDBOX_DESTROY_PENDING_MESSAGE,
        reason: 'destroy_pending',
      }),
      { code: SANDBOX_WORKSPACE_DESTROYED_CODE },
      undefined,
    ];
    for (const other of others) {
      expect(isWorkspaceDestroyedRefusal(other)).toBe(false);
    }
  });
});
