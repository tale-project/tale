// @vitest-environment node

/**
 * The llm door, off the wire: transport is `createBuilderModel`'s and proven
 * in its own suite, so these tests substitute it and prove what THIS module
 * owns — which connector serves an explicitly named model, how a reply
 * becomes `{text}` or schema-checked `{data}`, and that every refusal names
 * the problem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';

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
  schemaViolations,
} from './llm_call';

const ORG = 'org_llm';

/** Credential rows by provider slug; the fake ctx serves them. */
let credentials: Record<string, unknown>;

const ctx = {
  runQuery: vi.fn((_ref: unknown, args: { providerSlug: string }) =>
    Promise.resolve(credentials[args.providerSlug] ?? null),
  ),
} as unknown as ActionCtx;

const DIRECT = { status: 'active', authMethod: 'api-key' };

beforeEach(() => {
  vi.clearAllMocks();
  credentials = {};
  resolveConnectors.mockResolvedValue([{ name: 'first' }, { name: 'second' }]);
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
});

describe('automationLlmCall', () => {
  it('picks the first connector that serves the model directly', async () => {
    // "first" has the credential but not the model; "second" serves it.
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'second' ? [{ id: 'vendor/small-1' }] : [],
        ),
    );

    const reply = await automationLlmCall(
      ctx,
      ORG,
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
    getProviderCatalog.mockResolvedValue([{ id: 'vendor/small-1' }]);

    await expect(
      automationLlmCall(ctx, ORG)({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/no configured provider serves model "vendor\/small-1"/);
  });

  it('says so when the only catalogs were unreachable', async () => {
    credentials = { first: DIRECT, second: DIRECT };
    getProviderCatalog.mockRejectedValue(new Error('models endpoint 500'));

    await expect(
      automationLlmCall(ctx, ORG)({ model: 'vendor/small-1', prompt: 'x' }),
    ).rejects.toThrow(/catalog for "first", "second" was unreachable/);
  });

  it('resolves each model once per door, not once per call', async () => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([{ id: 'vendor/small-1' }]);

    const door = automationLlmCall(ctx, ORG);
    await door({ model: 'vendor/small-1', prompt: 'one' });
    await door({ model: 'vendor/small-1', prompt: 'two' });

    expect(resolveConnectors).toHaveBeenCalledTimes(1);
    expect(createBuilderModel).toHaveBeenCalledTimes(1);
    expect(builderModel).toHaveBeenCalledTimes(2);
  });

  it('asks for the schema in the system prompt and returns the parsed data', async () => {
    credentials = { first: DIRECT };
    getProviderCatalog.mockResolvedValue([{ id: 'vendor/small-1' }]);
    builderModel.mockResolvedValue({ content: '```json\n{"score": 7}\n```' });
    const outputSchema = {
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    };

    const reply = await automationLlmCall(
      ctx,
      ORG,
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
    getProviderCatalog.mockResolvedValue([{ id: 'vendor/small-1' }]);
    const outputSchema = {
      type: 'object',
      properties: { score: { type: 'number' } },
      required: ['score'],
    };
    const door = automationLlmCall(ctx, ORG);

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
