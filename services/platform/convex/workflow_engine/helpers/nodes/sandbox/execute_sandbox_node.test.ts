import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../../_generated/server';
import type { SandboxNodeConfig } from '../../../types/nodes';
import { executeSandboxNode } from './execute_sandbox_node';

// executeSandboxNode routes the unified sandbox result onto a port. A DURABLE
// agent run that handed off mid-window (status 'running', the exec still
// running) must surface on the 'running' port so the handler re-enters the SAME
// step; every TERMINAL outcome (completed/failed/cancelled/timeout) — and every
// script run — stays on 'success', with the ok/error verdict in output.data so
// a following condition branches as before.

const agentConfig = (): SandboxNodeConfig => ({
  run: {
    agent: 'issue-desk/desk-implementer',
    budget: { maxCents: 100, maxWallClockMs: 5_400_000 },
  },
});

const scriptConfig = (): SandboxNodeConfig => ({
  run: { script: 'pack://issue-desk/x.py', language: 'python' },
});

function ctxReturning(data: Record<string, unknown>): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: minimal ActionCtx surface
  return {
    runAction: vi.fn(() => Promise.resolve(data)),
  } as unknown as ActionCtx;
}

describe('executeSandboxNode port mapping', () => {
  it('maps an agent handoff (status "running") to the "running" port', async () => {
    const ctx = ctxReturning({
      mode: 'agent',
      ok: false,
      status: 'running',
      outputFileIds: [],
    });
    const result = await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(result.port).toBe('running');
    expect(result.output).toMatchObject({ type: 'sandbox' });
  });

  it('maps a completed agent run to the "success" port', async () => {
    const ctx = ctxReturning({
      mode: 'agent',
      ok: true,
      status: 'completed',
      outputFileIds: [],
    });
    const result = await executeSandboxNode(
      ctx,
      agentConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'implement',
    );
    expect(result.port).toBe('success');
  });

  it('keeps a TERMINAL agent failure on "success" (verdict lives in output.data)', async () => {
    for (const status of ['failed', 'cancelled', 'timeout']) {
      const ctx = ctxReturning({
        mode: 'agent',
        ok: false,
        status,
        outputFileIds: [],
      });
      const result = await executeSandboxNode(
        ctx,
        agentConfig(),
        { organizationId: 'org-1' },
        'exec-1',
        'implement',
      );
      expect(result.port, `status=${status}`).toBe('success');
    }
  });

  it('a deterministic script run never takes the "running" port', async () => {
    const ctx = ctxReturning({
      mode: 'script',
      ok: true,
      status: 'completed',
      outputFileIds: [],
    });
    const result = await executeSandboxNode(
      ctx,
      scriptConfig(),
      { organizationId: 'org-1' },
      'exec-1',
      'verify',
    );
    expect(result.port).toBe('success');
  });
});
