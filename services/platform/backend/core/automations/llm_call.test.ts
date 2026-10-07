// @vitest-environment node

/**
 * The llm door, off the wire: transport is `createBuilderModel`'s and proven
 * in its own suite, so these tests substitute it and prove what THIS module
 * owns — which connector serves an explicitly named model, how a reply
 * becomes `{text}` or schema-checked `{data}`, that every refusal names the
 * problem, and that each call is measured against and booked to its run's
 * budgets (the measure and the booking themselves are `llm-metering.ts`'s).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { EmptyReplyError } from '../automations_builder/chat_wire';
import type { ActionCtx } from '../lib/ctx';
import { NodeFailure } from './failure';

const {
  builderModel,
  createBuilderModel,
  getProviderCatalog,
  resolveConnectors,
} = vi.hoisted(() => ({
  builderModel: vi.fn(),
  createBuilderModel: vi.fn(),
  getProviderCatalog: vi.fn(),
  resolveConnectors: vi.fn(),
}));

vi.mock('../automations_builder/model_call', () => ({
  createBuilderModel,
}));
vi.mock('../lib/providers/catalog_fetch', () => ({
  getProviderCatalog,
}));
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: resolveConnectors,
}));

import {
  automationLlmCall,
  extractJsonValue,
  resolveServingTarget,
  schemaViolations,
  walkLlmServing,
} from './llm_call';

const ORG = 'org_llm';
const RUN = 'run_llm';

/** Credential rows by provider slug; the fake ctx serves them. */
let credentials: Record<string, unknown>;
/** What the run's budget check answers. */
let admission: unknown;

const runQuery = vi.fn((ref: unknown, args: { providerSlug: string }) =>
  Promise.resolve(
    functionRefName(ref) === 'automations/queries:checkLlmStepBudget'
      ? admission
      : (credentials[args.providerSlug] ?? null),
  ),
);
const runMutation = vi.fn((_ref: unknown, _args: unknown) =>
  Promise.resolve(null),
);
const ctx = { runQuery, runMutation } as unknown as ActionCtx;

/** The bookings the door asked for, by their arguments. */
function bookings(): unknown[] {
  return runMutation.mock.calls
    .filter(
      ([ref]) =>
        functionRefName(ref) === 'automations/mutations:recordLlmStepUsage',
    )
    .map(([, args]) => args);
}

const DIRECT = { status: 'active', authMethod: 'api-key' };

beforeEach(() => {
  vi.clearAllMocks();
  credentials = {};
  admission = { allowed: true };
  resolveConnectors.mockResolvedValue([
    { name: 'first', catalog: { source: 'static' } },
    { name: 'second', catalog: { source: 'static' } },
  ]);
  getProviderCatalog.mockResolvedValue([]);
  createBuilderModel.mockReturnValue(builderModel);
  builderModel.mockResolvedValue({ content: 'a fine sentence' });
});

describe('extractJsonValue', () => {
  it('takes the JSON wherever the model put it', () => {
    expect(extractJsonValue('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonValue('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonValue('```\n[1,2]\n```')).toEqual([1, 2]);
    expect(
      extractJsonValue('Here you go:\n{"a":{"b":2}}\nHope that helps!'),
    ).toEqual({ a: { b: 2 } });
  });

  it('refuses a reply with no JSON in it', () => {
    expect(() => extractJsonValue('certainly, six of them')).toThrow(
      /nothing in the reply parses/,
    );
  });
});

describe('schemaViolations', () => {
  const schema = {
    type: 'object',
    properties: { score: { type: 'number' } },
    required: ['score'],
  };

  it('accepts a satisfying value', () => {
    expect(schemaViolations(schema, { score: 7 })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(schemaViolations(schema, { score: 'high' })).toMatch(
      /\/score .*number/,
    );
    expect(schemaViolations(schema, {})).toMatch(/score/);
  });

  it('checks a schema carrying $id as many times as replies arrive', () => {
    // Ordinary author JSON Schema names itself. A per-module Ajv without a
    // cache clear accepted the first reply and threw "schema with key or id
    // … already exists" on every later one — each forEach item, repeat pass
    // and run on the worker after the first.
    const named = {
      $id: 'https://example.test/schemas/score',
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    };
    expect(schemaViolations(named, { score: 1 })).toBeNull();
    expect(schemaViolations(named, { score: 2 })).toBeNull();
    expect(schemaViolations(named, { score: 'no' })).toMatch(/\/score/);
    // The node's document is not Ajv's to annotate.
    expect(named).toEqual({
      $id: 'https://example.test/schemas/score',
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    });
  });
});

describe('automationLlmCall', () => {
  it('picks the first connector that serves the model directly', async () => {
    // "first" has the credential but not the model; "second" serves it.
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'second'
            ? [{ id: 'vendor/small-1', tags: ['chat'] }]
            : [],
        ),
    );

    const reply = await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({
      model: 'vendor/small-1',
      prompt: 'Summarize.',
      system: 'Be terse.',
    });

    expect(reply).toEqual({ text: 'a fine sentence' });
    expect(createBuilderModel).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        organizationId: ORG,
        target: { providerSlug: 'second', modelId: 'vendor/small-1' },
      }),
    );
    expect(builderModel).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'Be terse.' },
          { role: 'user', content: 'Summarize.' },
        ],
      }),
    );
  });

  it('skips connectors whose credential is not a direct one, or refuses the model', async () => {
    credentials = {
      first: { status: 'active', authMethod: 'subscription' },
      second: { ...DIRECT, modelAllowlist: ['other/model'] },
    };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/small-1', tags: ['chat'] },
    ]);

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/no configured provider serves model "vendor\/small-1"/);
  });

  it('serves a pack model id via OpenRouter catalog spelling on the wire', async () => {
    // Packs / Tale static catalog use hyphen minors; OpenRouter lists dots.
    resolveConnectors.mockResolvedValue([
      { name: 'openrouter', catalog: { source: 'static' } },
    ]);
    credentials = { openrouter: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'anthropic/claude-haiku-4.5', tags: ['chat'] },
    ]);

    await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Triage.',
    });

    expect(createBuilderModel).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        target: {
          providerSlug: 'openrouter',
          modelId: 'anthropic/claude-haiku-4.5',
        },
      }),
    );
  });

  it('serves a pack model id via Anthropic bare catalog id on the wire', async () => {
    resolveConnectors.mockResolvedValue([
      { name: 'anthropic', catalog: { source: 'static' } },
    ]);
    credentials = { anthropic: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'claude-haiku-4-5', tags: ['chat'] },
    ]);

    await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Triage.',
    });

    expect(createBuilderModel).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        target: {
          providerSlug: 'anthropic',
          modelId: 'claude-haiku-4-5',
        },
      }),
    );
  });

  it('honors an allowlist written in the catalog dialect when the pack uses Tale form', async () => {
    resolveConnectors.mockResolvedValue([
      { name: 'openrouter', catalog: { source: 'static' } },
    ]);
    credentials = {
      openrouter: {
        ...DIRECT,
        modelAllowlist: ['anthropic/claude-haiku-4.5'],
      },
    };
    getProviderCatalog.mockResolvedValue([
      { id: 'anthropic/claude-haiku-4.5', tags: ['chat'] },
    ]);

    await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({
      model: 'anthropic/claude-haiku-4-5',
      prompt: 'Triage.',
    });

    expect(createBuilderModel).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        target: {
          providerSlug: 'openrouter',
          modelId: 'anthropic/claude-haiku-4.5',
        },
      }),
    );
  });

  it('says so when the only catalogs were unreachable', async () => {
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockRejectedValue(new Error('models endpoint 500'));

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/catalog for "first", "second" was unreachable/);
  });

  it('resolves each model once per door, not once per call', async () => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/small-1', tags: ['chat'] },
    ]);

    const door = automationLlmCall(ctx, ORG, RUN);
    await door({ model: 'vendor/small-1', prompt: 'one' });
    await door({ model: 'vendor/small-1', prompt: 'two' });

    expect(resolveConnectors).toHaveBeenCalledTimes(1);
    expect(createBuilderModel).toHaveBeenCalledTimes(1);
    expect(builderModel).toHaveBeenCalledTimes(2);
  });

  it('asks for the schema in the system prompt and returns the parsed data', async () => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/small-1', tags: ['chat'] },
    ]);
    builderModel.mockResolvedValue({ content: '```json\n{"score": 7}\n```' });
    const outputSchema = {
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    };

    const reply = await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({
      model: 'vendor/small-1',
      prompt: 'Score it.',
      outputSchema,
    });

    expect(reply).toEqual({ data: { score: 7 } });
    const request = builderModel.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[0].content).toContain(JSON.stringify(outputSchema));
  });

  it('fails the call, naming the problem, when the reply defies the schema', async () => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/small-1', tags: ['chat'] },
    ]);
    const outputSchema = {
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    };
    const door = automationLlmCall(ctx, ORG, RUN);

    builderModel.mockResolvedValue({ content: 'about a seven, I think' });
    await expect(
      door({ model: 'vendor/small-1', prompt: 'x', outputSchema }),
    ).rejects.toThrow(/not the JSON its outputSchema requires/);

    builderModel.mockResolvedValue({ content: '{"score": "high"}' });
    await expect(
      door({ model: 'vendor/small-1', prompt: 'x', outputSchema }),
    ).rejects.toThrow(/does not satisfy the node's outputSchema/);
  });
});

describe('automationLlmCall and the run’s budgets', () => {
  beforeEach(() => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/small-1', tags: ['chat'] },
    ]);
  });

  it('books each call’s tokens to its run, priced under the serving connector [GOV-R14]', async () => {
    builderModel.mockResolvedValue({
      content: 'a fine sentence',
      usage: { prompt: 120, completion: 30 },
    });

    await automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({ model: 'vendor/small-1', prompt: 'Summarize.' });

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      runId: RUN,
    });
    expect(bookings()).toEqual([
      {
        organizationId: ORG,
        runId: RUN,
        provider: 'first',
        model: 'vendor/small-1',
        inputTokens: 120,
        outputTokens: 30,
      },
    ]);
  });

  it('refuses the call before the provider once a cap binding the run is reached [GOV-R4]', async () => {
    admission = {
      allowed: false,
      reason:
        "Usage limit reached. This project's monthly cost limit is used up until 2026-11-01T00:00:00.000Z.",
    };

    const refusal = automationLlmCall(
      ctx,
      ORG,
      RUN,
    )({ model: 'vendor/small-1', prompt: 'x' });

    await expect(refusal).rejects.toBeInstanceOf(NodeFailure);
    await expect(refusal).rejects.toMatchObject({
      code: 'budget_exceeded',
      message: expect.stringContaining(
        "This project's monthly cost limit is used up",
      ),
    });
    expect(builderModel).not.toHaveBeenCalled();
    expect(bookings()).toEqual([]);
  });

  it('measures every call of a door, not the first alone', async () => {
    const door = automationLlmCall(ctx, ORG, RUN);
    await door({ model: 'vendor/small-1', prompt: 'one' });
    admission = { allowed: false, reason: 'Usage limit reached.' };

    await expect(
      door({ model: 'vendor/small-1', prompt: 'two' }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect(builderModel).toHaveBeenCalledTimes(1);
  });

  it('books a reply with no text before the step fails on it', async () => {
    builderModel.mockRejectedValue(
      new EmptyReplyError({ prompt: 40, completion: 8000 }),
    );

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/no text content/);
    expect(bookings()).toEqual([
      expect.objectContaining({ inputTokens: 40, outputTokens: 8000 }),
    ]);
  });

  it('books a reply that defies the node’s schema — the call was made', async () => {
    builderModel.mockResolvedValue({
      content: 'about a seven',
      usage: { prompt: 10, completion: 4 },
    });

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({
        model: 'vendor/small-1',
        prompt: 'x',
        outputSchema: { type: 'object' },
      }),
    ).rejects.toMatchObject({ code: 'llm_output_invalid' });
    expect(bookings()).toEqual([
      expect.objectContaining({ inputTokens: 10, outputTokens: 4 }),
    ]);
  });

  it('keeps the reply when its booking fails, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    builderModel.mockResolvedValue({
      content: 'a fine sentence',
      usage: { prompt: 1, completion: 1 },
    });
    runMutation.mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({ model: 'vendor/small-1', prompt: 'x' }),
    ).resolves.toEqual({ text: 'a fine sentence' });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`run ${RUN}: booking an llm call`),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('fails loudly on a budget answer it cannot read', async () => {
    admission = { allowed: 'maybe' };

    await expect(
      automationLlmCall(
        ctx,
        ORG,
        RUN,
      )({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/unexpected shape/);
    expect(builderModel).not.toHaveBeenCalled();
  });
});

describe('resolveServingTarget', () => {
  // Pinned resolution moved to `resolvePinnedAgentServing` and is proven in
  // `lib/providers/agent_serving.test.ts`; this door is unpinned-only.
  it('walks connectors in order and serves from the first match', async () => {
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/shared', tags: ['chat'] },
    ]);

    await expect(
      resolveServingTarget(ctx, ORG, 'vendor/shared'),
    ).resolves.toEqual({ providerSlug: 'first', modelId: 'vendor/shared' });
  });
});

// The validator's model check rides this walk, so what it warns about is
// exactly what a live run refuses (2026-09-26 evaluation, D-16).
describe('walkLlmServing', () => {
  it('answers the serving connector, or no target with the catalogs it could not read', async () => {
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockResolvedValue([
      { id: 'vendor/shared', tags: ['chat'] },
    ]);
    await expect(
      walkLlmServing(ctx, ORG, 'vendor/shared'),
    ).resolves.toMatchObject({
      target: { providerSlug: 'first', modelId: 'vendor/shared' },
      unreachable: [],
    });
    await expect(
      walkLlmServing(ctx, ORG, 'nobody/serves'),
    ).resolves.toMatchObject({
      target: null,
      unreachable: [],
    });
  });
});
