// @vitest-environment node

/**
 * A managed harness turn's model window means what the chat lane means: the
 * serving connector's catalog window, narrowed by the organization's context
 * limit for the person the turn acts for (the run's starter, whom the spend
 * cap binds too). Claude Code otherwise assumes 200,000 tokens for a model it
 * does not know, and a local model serving 32,768 grew a turn to ~140K
 * before the CLI compacted. The resolution is best-effort: it never fails a
 * turn, and an unresolvable model leaves the harness to its own sizing.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import { resolveModel } from '../lib/providers/resolve_model';
import {
  buildExternalTurnExec,
  resolveHarnessTurnContextWindow,
} from './external_turn_shared';

vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: vi.fn(),
}));

const TURN = {
  organizationId: 'org-window',
  providerSlug: 'local-inference',
  modelId: 'qwen3-32b',
  sessionId: 'pa-agent-1',
  execId: 'exec-window',
  kind: 'task-agent',
} as const;

function servesWindow(contextWindow: number): void {
  const entry: ModelCatalogEntry = {
    id: TURN.modelId,
    provider: TURN.providerSlug,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow,
  };
  vi.mocked(resolveModel).mockResolvedValue({
    entry,
    connector: { name: TURN.providerSlug } as never,
  });
}

/** A ctx answering the two governance reads; everything else is a defect. */
function governanceCtx(answers: { attribution: unknown; cap: unknown }): {
  ctx: ActionCtx;
  calls: Array<{ name: string; args: unknown }>;
} {
  const calls: Array<{ name: string; args: unknown }> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: unknown) => {
      const name = functionRefName(ref);
      calls.push({ name, args });
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        if (answers.attribution instanceof Error) throw answers.attribution;
        return answers.attribution;
      }
      if (name === 'governance/queries:getContextCapInternal') {
        if (answers.cap instanceof Error) throw answers.cap;
        return answers.cap;
      }
      throw new Error(`unexpected query ${name}`);
    },
  } as unknown as ActionCtx;
  return { ctx, calls };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('resolveHarnessTurnContextWindow', () => {
  it('reads the serving connector’s own catalog entry', async () => {
    servesWindow(32_768);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: null,
    });
    await expect(resolveHarnessTurnContextWindow(ctx, TURN)).resolves.toBe(
      32_768,
    );
    // Held to the serving connector: another connector listing the same id
    // must not answer for it.
    expect(resolveModel).toHaveBeenCalledExactlyOnceWith(
      ctx,
      TURN.organizationId,
      TURN.modelId,
      TURN.providerSlug,
      true,
    );
  });

  it('narrows the window to the context limit of the run’s starter', async () => {
    servesWindow(262_144);
    const { ctx, calls } = governanceCtx({
      attribution: { userId: 'user-1', agentSlug: 'Invoice desk' },
      cap: 131_072,
    });
    await expect(resolveHarnessTurnContextWindow(ctx, TURN)).resolves.toBe(
      131_072,
    );
    expect(calls).toEqual([
      {
        name: 'sandbox/session_queries:getSessionOpAttribution',
        args: {
          organizationId: TURN.organizationId,
          sessionId: TURN.sessionId,
          execId: TURN.execId,
          kind: TURN.kind,
        },
      },
      {
        name: 'governance/queries:getContextCapInternal',
        args: { organizationId: TURN.organizationId, userId: 'user-1' },
      },
    ]);
  });

  it('never widens the window past the catalog’s', async () => {
    servesWindow(32_768);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: 131_072,
    });
    await expect(resolveHarnessTurnContextWindow(ctx, TURN)).resolves.toBe(
      32_768,
    );
  });

  it('reads the limit for no one in particular when the op names nobody', async () => {
    servesWindow(262_144);
    const { ctx, calls } = governanceCtx({ attribution: null, cap: 100_000 });
    await expect(resolveHarnessTurnContextWindow(ctx, TURN)).resolves.toBe(
      100_000,
    );
    // The same subject the spend cap is evaluated for then: the empty id,
    // which only an organization-wide (default) rule matches.
    expect(calls[1]).toEqual({
      name: 'governance/queries:getContextCapInternal',
      args: { organizationId: TURN.organizationId, userId: '' },
    });
  });

  it('answers nothing when the model has no catalog entry — never a guess', async () => {
    vi.mocked(resolveModel).mockRejectedValue(
      new Error('Provider "local-inference" no longer serves model'),
    );
    const { ctx, calls } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: 32_768,
    });
    await expect(
      resolveHarnessTurnContextWindow(ctx, TURN),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('keeps the catalog window when the context limit cannot be read', async () => {
    servesWindow(32_768);
    const { ctx } = governanceCtx({
      attribution: new Error('database unavailable'),
      cap: null,
    });
    await expect(resolveHarnessTurnContextWindow(ctx, TURN)).resolves.toBe(
      32_768,
    );
    expect(console.warn).toHaveBeenCalledOnce();
  });
});

describe('buildExternalTurnExec carries the window to the harness', () => {
  const base = {
    harness: 'claude-code',
    gatewayModel: 'local-inference-org-window/qwen3-32b',
    serving: { kind: 'gateway', token: 'sk-bf-window' },
    instructions: '',
    prompt: 'Book the synthetic invoice',
    execId: 'exec-window',
  } as const;

  it('hands Claude Code a resolved window below its own assumption', () => {
    const exec = buildExternalTurnExec({ ...base, contextWindow: 32_768 });
    expect(exec.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32768');
  });

  it('leaves Claude Code to decide without one', () => {
    const exec = buildExternalTurnExec(base);
    expect(exec.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('');
  });
});
