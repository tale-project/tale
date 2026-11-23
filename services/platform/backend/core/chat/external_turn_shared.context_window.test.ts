// @vitest-environment node

/**
 * A managed harness turn's model window means what the chat lane means: the
 * serving connector's catalog window, narrowed by the organization's context
 * limit for the person the turn acts for (the run's starter, whom the spend
 * cap binds too). Claude Code otherwise assumes 200,000 tokens for a model it
 * does not know, and a local model serving 32,768 grew a turn to ~140K
 * before the CLI compacted. The same catalog entry gives the model's output
 * limit, never more than that window: Pi otherwise asks every request for at
 * most 16,384 tokens. The resolution is best-effort: it never fails a turn,
 * and an unresolvable model leaves the harness to its own sizing.
 */

import type {
  DeclaredModel,
  ModelCatalogEntry,
} from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { synthesizeAllowlistCatalog } from '../../../lib/shared/providers/allowlist_catalog';
import type { ActionCtx } from '../lib/ctx';
import { resolveModel } from '../lib/providers/resolve_model';
import {
  buildExternalTurnExec,
  resolveHarnessTurnModelLimits,
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

/** The serving connector's catalog entry: its window, its output limit
 * when it names one, and its reasoning knob when it has one. */
function servesWindow(
  contextWindow: number,
  maxOutputTokens?: number,
  reasoning?: ModelCatalogEntry['reasoning'],
): void {
  const entry: ModelCatalogEntry = {
    id: TURN.modelId,
    provider: TURN.providerSlug,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
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

describe('resolveHarnessTurnModelLimits', () => {
  it('reads the serving connector’s own catalog entry', async () => {
    servesWindow(32_768);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: null,
    });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 32_768,
    });
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
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 131_072,
    });
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
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 32_768,
    });
  });

  it('reads the limit for no one in particular when the op names nobody', async () => {
    servesWindow(262_144);
    const { ctx, calls } = governanceCtx({ attribution: null, cap: 100_000 });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 100_000,
    });
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
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({});
    expect(calls).toEqual([]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('keeps the catalog window when the context limit cannot be read', async () => {
    servesWindow(32_768);
    const { ctx } = governanceCtx({
      attribution: new Error('database unavailable'),
      cap: null,
    });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 32_768,
    });
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('reads the output limit from the same catalog entry', async () => {
    servesWindow(49_152, 12_288);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: null,
    });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 49_152,
      maxOutputTokens: 12_288,
    });
    // One lookup answers both.
    expect(resolveModel).toHaveBeenCalledOnce();
  });

  it('never lets the output limit pass the starter’s narrower window', async () => {
    servesWindow(262_144, 65_536);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: 49_152,
    });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 49_152,
      maxOutputTokens: 49_152,
    });
  });

  it('says the model can be told how hard to think when its entry has a reasoning knob', async () => {
    for (const knob of [
      { knob: 'effort' as const },
      { knob: 'effort' as const, off: 'none' as const },
      { knob: 'budget-tokens' as const },
    ]) {
      servesWindow(200_000, 64_000, knob);
      const { ctx } = governanceCtx({ attribution: {}, cap: null });
      await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
        reasoning: true,
      });
    }
  });

  it('says no for a model without a knob, and for one whose endpoint refuses an effort beside tools', async () => {
    servesWindow(200_000);
    const plain = governanceCtx({ attribution: {}, cap: null });
    await expect(
      resolveHarnessTurnModelLimits(plain.ctx, TURN),
    ).resolves.not.toHaveProperty('reasoning');
    // An agent turn always carries tools.
    servesWindow(200_000, undefined, {
      knob: 'effort',
      off: 'none',
      toolsRequireOff: true,
    });
    const refused = governanceCtx({ attribution: {}, cap: null });
    await expect(
      resolveHarnessTurnModelLimits(refused.ctx, TURN),
    ).resolves.not.toHaveProperty('reasoning');
  });

  it('keeps the catalog output limit under a context limit above it', async () => {
    servesWindow(262_144, 65_536);
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: 131_072,
    });
    await expect(resolveHarnessTurnModelLimits(ctx, TURN)).resolves.toEqual({
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
    });
  });
});

describe('buildExternalTurnExec carries the model limits to the harness', () => {
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

  /** The model entries of the models.json Pi's wrapper stages. */
  function piModels(exec: { stdin?: string }): unknown {
    const envelope = JSON.parse(
      (exec.stdin ?? '{}').split('\n')[0] ?? '{}',
    ) as {
      models?: { providers?: Record<string, { models?: unknown }> };
    };
    return envelope.models?.providers?.['tale-gateway']?.models;
  }

  it('hands Pi the window and the output limit', () => {
    const exec = buildExternalTurnExec({
      ...base,
      harness: 'pi',
      contextWindow: 49_152,
      maxOutputTokens: 12_288,
    });
    expect(piModels(exec)).toEqual([
      {
        id: base.gatewayModel,
        contextWindow: 49_152,
        maxTokens: 12_288,
        input: ['text'],
      },
    ]);
  });

  it('leaves Pi its own limits without them', () => {
    const exec = buildExternalTurnExec({ ...base, harness: 'pi' });
    expect(piModels(exec)).toEqual([
      { id: base.gatewayModel, input: ['text'] },
    ]);
  });

  it('tells Pi the model can be told how hard to think', () => {
    const exec = buildExternalTurnExec({
      ...base,
      harness: 'pi',
      reasoning: true,
    });
    expect(piModels(exec)).toEqual([
      { id: base.gatewayModel, input: ['text'], reasoning: true },
    ]);
  });
});

describe('a catalog-less provider’s declared window reaches Claude Code', () => {
  // An organization's own Anthropic-format gateway lists no models, so the
  // window comes from what its definition declares. Undeclared, every model
  // got the synthesized 128,000, and each managed Claude Code run compacted
  // near 95,000 tokens however large the model's real window (#5073).
  const GATEWAY_TURN = {
    ...TURN,
    providerSlug: 'claude-gateway',
    modelId: 'claude-sonnet-gw',
  } as const;

  /** The `CLAUDE_CODE_AUTO_COMPACT_WINDOW` a turn on the gateway's model
   * launches with, when its definition declares `models`. */
  async function compactWindowFor(
    models: DeclaredModel[],
  ): Promise<string | undefined> {
    const [entry] = synthesizeAllowlistCatalog(
      { name: GATEWAY_TURN.providerSlug, catalog: { source: 'none', models } },
      [GATEWAY_TURN.modelId],
    );
    if (entry === undefined) throw new Error('the allowlisted id is served');
    vi.mocked(resolveModel).mockResolvedValue({
      entry,
      connector: { name: GATEWAY_TURN.providerSlug } as never,
    });
    const { ctx } = governanceCtx({
      attribution: { userId: 'user-1' },
      cap: null,
    });
    const limits = await resolveHarnessTurnModelLimits(ctx, GATEWAY_TURN);
    return buildExternalTurnExec({
      harness: 'claude-code',
      gatewayModel: 'claude-gateway-org-window/claude-sonnet-gw',
      serving: { kind: 'gateway', token: 'sk-bf-window' },
      instructions: '',
      prompt: 'Review the synthetic repository',
      execId: GATEWAY_TURN.execId,
      ...limits,
    }).env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  }

  it.each([200_000, 1_000_000])(
    'leaves Claude Code its own window for a declared %i tokens',
    async (contextWindow) => {
      await expect(
        compactWindowFor([{ id: GATEWAY_TURN.modelId, contextWindow }]),
      ).resolves.toBe('');
    },
  );

  it('hands Claude Code a declared window below its own assumption', async () => {
    await expect(
      compactWindowFor([{ id: GATEWAY_TURN.modelId, contextWindow: 131_072 }]),
    ).resolves.toBe('131072');
  });

  it('hands Claude Code the 128,000-token floor for a model the definition does not describe', async () => {
    await expect(
      compactWindowFor([{ id: 'claude-haiku-gw', contextWindow: 200_000 }]),
    ).resolves.toBe('128000');
  });
});
