import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  SessionExecLimitError,
  SessionMemoryBusyError,
  SpawnerBusyError,
} from '../node_only/sandbox/helpers/session_client';
import {
  isDestroyPendingRefusal,
  sandboxCapacityRefusal,
} from '../node_only/sandbox/start_refusal';
import { runParkReason, SANDBOX_SESSION_HELD_REASON } from './run_park_reason';

/** The reason a start's refusal parks its run with, as the host decides it. */
function reasonFor(err: unknown) {
  const noRoom = sandboxCapacityRefusal(err);
  expect(noRoom !== null || isDestroyPendingRefusal(err)).toBe(true);
  return runParkReason(err, noRoom);
}

describe('why a parked agent run waits', () => {
  it('names the organization limit for a spent agent-worker budget', () => {
    expect(
      reasonFor(
        new AppError({
          code: 'QUOTA_EXCEEDED',
          message: 'At most 2 project sandbox sessions can be active.',
        }),
      ),
    ).toBe('org_limit');
  });

  it('names the host, the destroy and the exec limit by their refusals', () => {
    expect(reasonFor(new SpawnerBusyError(5000))).toBe('host');
    expect(
      reasonFor(
        new AppError({
          code: 'QUOTA_EXCEEDED',
          message: 'being destroyed',
          reason: 'destroy_pending',
        }),
      ),
    ).toBe('destroy_pending');
    expect(reasonFor(new SessionExecLimitError('pa-agent-w2', 'exec-1'))).toBe(
      'exec_limit',
    );
  });

  it('names the room, not an earlier process, for a sandbox short of memory', () => {
    expect(
      reasonFor(
        new SessionMemoryBusyError(
          'pa-agent-w2',
          'exec-1',
          5_000,
          'the session is using 90% or more of its memory limit',
        ),
      ),
    ).toBe('host');
  });

  it('blames no limit for a start that raced into a worker already held', () => {
    const held = new AppError({
      code: 'QUOTA_EXCEEDED',
      message: 'This project_agent already has an active sandbox session.',
      reason: SANDBOX_SESSION_HELD_REASON,
    });
    expect(reasonFor(held)).toBeUndefined();
    // The sessions domain's own error, before a shim re-shapes it.
    expect(
      reasonFor(
        Object.assign(
          new Error(
            'This project_agent already has an active sandbox session.',
          ),
          { code: 'QUOTA_EXCEEDED', reason: SANDBOX_SESSION_HELD_REASON },
        ),
      ),
    ).toBeUndefined();
  });

  it("reads a refusal's reason from its fields, never from its words (#4159)", () => {
    // A spent budget whose message merely quotes the held reason still
    // blames the limit.
    expect(
      reasonFor(
        Object.assign(
          new Error(
            `At most 2 workflow sandbox sessions ${JSON.stringify({ reason: SANDBOX_SESSION_HELD_REASON })}`,
          ),
          { code: 'QUOTA_EXCEEDED' },
        ),
      ),
    ).toBe('org_limit');
  });
});
