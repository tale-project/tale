// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { USE_WORKSPACE_BRIEF_MAX_CHARS } from '../../../lib/agent/work-tools.ts';
import { FULL_LOADOUT, testScope } from './test-helpers.ts';
import { runUseWorkspace } from './use-workspace.ts';

function withEscalation(
  answer: { accepted: true } | { accepted: false; message: string } = {
    accepted: true,
  },
) {
  const request = vi.fn(() => Promise.resolve(answer));
  return {
    request,
    scope: testScope({
      loadout: { ...FULL_LOADOUT, escalate: true },
      escalation: { request },
    }).scope,
  };
}

describe('use_workspace', () => {
  it('hands the reason and the brief to the lane and tells the model to end its turn', async () => {
    const { scope, request } = withEscalation();

    const result = await runUseWorkspace(scope, {
      reason: '  Needs the repository. ',
      brief: ' Fix the failing test in packages/core. ',
    });

    expect(request).toHaveBeenCalledExactlyOnceWith({
      reason: 'Needs the repository.',
      brief: 'Fix the failing test in packages/core.',
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(JSON.stringify(result)).toMatch(/End your turn/);
  });

  it('relays the lane’s refusal as a result the model can act on', async () => {
    const { scope } = withEscalation({
      accepted: false,
      message: 'The task was already handed over.',
    });
    await expect(
      runUseWorkspace(scope, { reason: 'why', brief: 'what' }),
    ).resolves.toEqual({
      status: 'unavailable',
      message: 'The task was already handed over.',
    });
  });

  it('answers a turn with nowhere to hand over that it has none', async () => {
    await expect(
      runUseWorkspace(testScope().scope, { reason: 'why', brief: 'what' }),
    ).resolves.toMatchObject({ status: 'unavailable' });
  });

  it.each([
    [undefined, /takes \{"reason"/],
    [{ reason: 'why' }, /both a "reason" and a "brief"/],
    [{ reason: '', brief: 'what' }, /both a "reason" and a "brief"/],
    [
      { reason: 'why', brief: 'x'.repeat(USE_WORKSPACE_BRIEF_MAX_CHARS + 1) },
      /Keep the reason under/,
    ],
  ])(
    'refuses the arguments %j without handing anything over',
    async (input, message) => {
      const { scope, request } = withEscalation();
      const result = await runUseWorkspace(scope, input);
      expect(result).toMatchObject({ status: 'invalid_args' });
      expect((result as { message: string }).message).toMatch(message);
      expect(request).not.toHaveBeenCalled();
    },
  );
});
