import { describe, expect, it } from 'vitest';

import { offeredToHarness, toModelOptions } from './harness-offer';

/**
 * The agent pickers offer a model only where it can run: a subscription's
 * model on the harness its credential is bound to, and a model whose tools
 * work only on the Responses API on a harness that speaks that API. A model
 * offered anywhere else saved fine and failed at the first task start.
 */
describe('toModelOptions + offeredToHarness', () => {
  const [direct, responsesOnly, subscription] = toModelOptions([
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
  });

  it('offers a direct model to every harness', () => {
    if (direct === undefined) throw new Error('missing option');
    expect(offeredToHarness(direct, 'opencode', 'openai-chat')).toBe(true);
    expect(offeredToHarness(direct, 'claude-code', 'anthropic')).toBe(true);
  });

  it('offers a Responses-only model only to a harness that speaks the Responses API', () => {
    if (responsesOnly === undefined) throw new Error('missing option');
    expect(offeredToHarness(responsesOnly, 'codex', 'openai-responses')).toBe(
      true,
    );
    expect(offeredToHarness(responsesOnly, 'opencode', 'openai-chat')).toBe(
      false,
    );
    expect(offeredToHarness(responsesOnly, 'claude-code', 'anthropic')).toBe(
      false,
    );
    // Before the roster answers, the wire is unknown: nothing is promised.
    expect(offeredToHarness(responsesOnly, 'codex', undefined)).toBe(false);
  });

  it('offers a subscription model only to the harness it is bound to', () => {
    if (subscription === undefined) throw new Error('missing option');
    expect(offeredToHarness(subscription, 'claude-code', 'anthropic')).toBe(
      true,
    );
    expect(offeredToHarness(subscription, 'codex', 'openai-responses')).toBe(
      false,
    );
  });
});
