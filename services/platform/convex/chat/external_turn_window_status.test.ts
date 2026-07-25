// Regression for the "Queued — waiting to start" lie: an external turn's
// generation used to stay 'queued' until the FIRST drain window ended (up to
// 90s), even though the exec was already running. The kick window must flip
// the generation to streaming BEFORE it blocks in the drain; an attach-only
// window must not (its end-of-window cursor advance owns the bump there).

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDrain = vi.fn();
vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) => mockDrain(...args),
  sessionCancelExec: vi.fn(),
  sessionCreate: vi.fn(),
  sessionIsAlive: vi.fn(),
  sessionStageFiles: vi.fn(),
  SessionDuplicateError: class SessionDuplicateError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: vi.fn(),
}));
vi.mock('../node_only/sandbox/llm_gateway_admin', () => ({
  getVirtualKeySpendCents: vi.fn(),
  revokeVirtualKey: vi.fn(),
}));

import { getFunctionName } from 'convex/server';

import { internal } from '../_generated/api';
import { drainExternalTurnWindow } from './external_turn_shared';

const SCOPE = {
  organizationId: 'org_1',
  threadId: 'thread_1',
  userId: 'user_1',
};

const TERMINAL = {
  status: 'completed' as const,
  exitCode: 0,
  durationMs: 5,
  stdoutBase64: '',
  stderrBase64: '',
  truncated: { stdout: false, stderr: false },
};

function createCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(null),
    // The terminal-window finalize path reads the op row (null = already
    // reaped → it settles without revoking) and never blocks these tests.
    runQuery: vi.fn().mockResolvedValue(null),
    runAction: vi.fn().mockResolvedValue(null),
  };
}

function startExec() {
  return {
    argv: ['claude', '-p', 'hi'],
    cwd: '/user/workspace',
    env: {},
  };
}

describe('drainExternalTurnWindow — generation status honesty', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips the generation out of queued BEFORE the kick window blocks', async () => {
    const ctx = createCtx();
    const order: string[] = [];
    ctx.runMutation.mockImplementation((ref: unknown) => {
      order.push(getFunctionName(ref as Parameters<typeof getFunctionName>[0]));
      return Promise.resolve(null);
    });
    mockDrain.mockImplementation(() => {
      order.push('drain');
      return Promise.resolve(TERMINAL);
    });

    await drainExternalTurnWindow(ctx as never, {
      scope: SCOPE,
      sessionId: 'session_1',
      execId: 'exec_1',
      messageId: 'msg_1' as never,
      harness: 'claude-code',
      providerSlug: 'deepseek',
      gatewayModel: 'deepseek-chat',
      start: startExec() as never,
    });

    const heartbeat = getFunctionName(
      internal.chat.generations.heartbeatInternal,
    );
    expect(order.indexOf(heartbeat)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(heartbeat)).toBeLessThan(order.indexOf('drain'));
  });

  it('does not heartbeat on an attach-only window', async () => {
    const ctx = createCtx();
    mockDrain.mockResolvedValue(TERMINAL);

    await drainExternalTurnWindow(ctx as never, {
      scope: SCOPE,
      sessionId: 'session_1',
      execId: 'exec_1',
      messageId: 'msg_1' as never,
      harness: 'claude-code',
      providerSlug: 'deepseek',
      gatewayModel: 'deepseek-chat',
    });

    const heartbeat = getFunctionName(
      internal.chat.generations.heartbeatInternal,
    );
    const called = ctx.runMutation.mock.calls.map((call) =>
      getFunctionName(call[0] as Parameters<typeof getFunctionName>[0]),
    );
    expect(called).not.toContain(heartbeat);
  });
});
