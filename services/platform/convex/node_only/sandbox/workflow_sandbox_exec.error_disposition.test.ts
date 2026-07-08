import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { WAIT_FIFO_CODE } from '../../sandbox/admission';
import {
  SessionNotFoundError,
  SpawnerBusyError,
} from './helpers/session_client';
import { TokenSourceError } from './token_pool_select';
import {
  SandboxAgentExecutionError,
  sandboxAgentThrowDisposition,
} from './workflow_sandbox_exec';

describe('sandboxAgentThrowDisposition', () => {
  it("classifies the spawner's definitive 404 as session-gone — on every segment, not just resume (the 2026-07-08 laundered desk-step regression)", () => {
    // The signature takes no `resuming` flag by design: a fresh segment whose
    // container vanished out-of-band must escape to the engine retry exactly
    // like a dead resume, never launder into an `{ok:false}` business outcome.
    expect(sandboxAgentThrowDisposition(new SessionNotFoundError('wf-x'))).toBe(
      'session-gone',
    );
  });

  it('rethrows infrastructure/execution errors and token-source exhaustion', () => {
    expect(
      sandboxAgentThrowDisposition(new SandboxAgentExecutionError('boom')),
    ).toBe('rethrow');
    expect(
      sandboxAgentThrowDisposition(new TokenSourceError('pool exhausted')),
    ).toBe('rethrow');
  });

  it('parks on capacity signals (WAIT_FIFO and the spawner 429)', () => {
    expect(
      sandboxAgentThrowDisposition(new ConvexError({ code: WAIT_FIFO_CODE })),
    ).toBe('park');
    expect(sandboxAgentThrowDisposition(new SpawnerBusyError(1500))).toBe(
      'park',
    );
    expect(sandboxAgentThrowDisposition(new SpawnerBusyError(undefined))).toBe(
      'park',
    );
  });

  it('fails everything else as a terminal business outcome', () => {
    expect(sandboxAgentThrowDisposition(new Error('agent blew up'))).toBe(
      'fail',
    );
    // A ConvexError that is NOT the FIFO signal (e.g. QUOTA_EXCEEDED) is a hard
    // policy stop, not a park.
    expect(
      sandboxAgentThrowDisposition(new ConvexError({ code: 'QUOTA_EXCEEDED' })),
    ).toBe('fail');
    expect(sandboxAgentThrowDisposition('string throw')).toBe('fail');
  });
});
