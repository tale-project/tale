import { describe, expect, it } from 'vitest';

import {
  offeredToHarness,
  toModelOptions,
  type HarnessModelFacts,
} from './harness-offer';

/**
 * The agent pickers offer a model only where it can run: a subscription's
 * model on the harness its credential is bound to, a model whose tools work
 * only on the Responses API on a harness that speaks that API, and a model
 * served through Anthropic's API not on Qwen Code, whose argument-less tools
 * lose their schema on the way there (#5353). A model offered anywhere else
 * saved fine and failed at the first task start.
 */
describe('toModelOptions + offeredToHarness', () => {
  const CLAUDE_CODE: HarnessModelFacts = {
    toolCallingWire: 'anthropic',
    anthropicModels: true,
  };
  const CODEX: HarnessModelFacts = {
    toolCallingWire: 'openai-responses',
    anthropicModels: true,
  };
  const OPENCODE: HarnessModelFacts = {
    toolCallingWire: 'openai-chat',
    anthropicModels: true,
  };
  const QWEN_CODE: HarnessModelFacts = {
    toolCallingWire: 'openai-chat',
    anthropicModels: false,
  };
  const [direct, responsesOnly, subscription, anthropic] = toModelOptions([
    {
      id: 'gpt-6-luna',
      label: 'GPT 6 Luna',
      providerSlug: 'openai',
      providerLabel: 'OpenAI',
      credential: { authMethod: 'api-key' },
    },
    {
      id: 'gpt-6.1-sol',
      label: 'GPT 6.1 Sol',
      providerSlug: 'openai',
      providerLabel: 'OpenAI',
      toolCallingApi: 'responses',
      credential: { authMethod: 'env' },
    },
    {
      id: 'claude-fable-5',
      label: 'Claude Fable 5',
      providerSlug: 'anthropic',
      providerLabel: 'Anthropic',
      credential: {
        authMethod: 'subscription-broker',
        constraints: { harness: 'claude-code' },
      },
    },
    {
      id: 'anthropic/claude-haiku-5-5',
      label: 'Claude Haiku 5.5',
      providerSlug: 'gateway',
      providerLabel: 'Gateway',
      anthropicApi: true,
      credential: { authMethod: 'api-key' },
    },
  ]);

  it('marks what each listing row may run on', () => {
    expect(direct).toEqual({
      id: 'gpt-6-luna',
      label: 'GPT 6 Luna',
      providerSlug: 'openai',
      providerLabel: 'OpenAI',
    });
    expect(responsesOnly).toMatchObject({ responsesOnly: true });
    expect(responsesOnly).not.toHaveProperty('subscription');
    expect(subscription).toMatchObject({
      subscription: { harness: 'claude-code' },
    });
    expect(anthropic).toMatchObject({ anthropicApi: true });
    expect(direct).not.toHaveProperty('anthropicApi');
  });

  it('offers a direct model to every harness', () => {
    if (direct === undefined) throw new Error('missing option');
    expect(offeredToHarness(direct, 'opencode', OPENCODE)).toBe(true);
    expect(offeredToHarness(direct, 'claude-code', CLAUDE_CODE)).toBe(true);
    expect(offeredToHarness(direct, 'qwen-code', QWEN_CODE)).toBe(true);
  });

  it('offers a Responses-only model only to a harness that speaks the Responses API', () => {
    if (responsesOnly === undefined) throw new Error('missing option');
    expect(offeredToHarness(responsesOnly, 'codex', CODEX)).toBe(true);
    expect(offeredToHarness(responsesOnly, 'opencode', OPENCODE)).toBe(false);
    expect(offeredToHarness(responsesOnly, 'claude-code', CLAUDE_CODE)).toBe(
      false,
    );
    // Before the roster answers, the wire is unknown: nothing is promised.
    expect(offeredToHarness(responsesOnly, 'codex', undefined)).toBe(false);
  });

  it('offers a subscription model only to the harness it is bound to', () => {
    if (subscription === undefined) throw new Error('missing option');
    expect(offeredToHarness(subscription, 'claude-code', CLAUDE_CODE)).toBe(
      true,
    );
    expect(offeredToHarness(subscription, 'codex', CODEX)).toBe(false);
  });

  it("offers a model served through Anthropic's API to every harness but Qwen Code", () => {
    if (anthropic === undefined) throw new Error('missing option');
    expect(offeredToHarness(anthropic, 'qwen-code', QWEN_CODE)).toBe(false);
    expect(offeredToHarness(anthropic, 'claude-code', CLAUDE_CODE)).toBe(true);
    expect(offeredToHarness(anthropic, 'opencode', OPENCODE)).toBe(true);
    expect(offeredToHarness(anthropic, 'codex', CODEX)).toBe(true);
    // Before the roster answers, the default holds: a runtime runs one.
    expect(offeredToHarness(anthropic, 'qwen-code', undefined)).toBe(true);
  });
});
