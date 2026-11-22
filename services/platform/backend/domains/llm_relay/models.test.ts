import { describe, expect, it } from 'vitest';

import { listedModels, matchRelayModel } from './models.ts';

const ORG = 'org_1';

describe('the model a request names', () => {
  const allowed = [
    { providerSlug: 'anthropic', modelId: 'claude-sonnet-5-5' },
    { providerSlug: 'deepseek', modelId: 'deepseek-v4' },
    {
      providerSlug: 'deepseek',
      modelId: 'deepseek-v4',
      anthropicHarnessLane: true,
    },
    { providerSlug: 'acme', modelId: 'shared-id' },
    { providerSlug: 'other', modelId: 'shared-id' },
  ];

  it('settles a full name to its connector and lane', () => {
    expect(
      matchRelayModel(
        ORG,
        'anthropic/claude-sonnet-5-5',
        allowed,
        'openai-chat',
      ),
    ).toEqual({
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      anthropicLane: false,
      ref: 'anthropic/claude-sonnet-5-5',
    });
    expect(
      matchRelayModel(
        ORG,
        'org_1__deepseek__deepseek-v4__anthropic/deepseek-v4',
        allowed,
        'openai-chat',
      ),
    ).toMatchObject({ providerSlug: 'deepseek', anthropicLane: true });
  });

  it('settles a bare id carried by one allowed model', () => {
    expect(
      matchRelayModel(ORG, 'claude-sonnet-5-5', allowed, 'anthropic'),
    ).toMatchObject({ providerSlug: 'anthropic', anthropicLane: false });
  });

  it('settles a bare id on both lanes of one model by the request’s wire', () => {
    expect(
      matchRelayModel(ORG, 'deepseek-v4', allowed, 'anthropic'),
    ).toMatchObject({ anthropicLane: true });
    expect(
      matchRelayModel(ORG, 'deepseek-v4', allowed, 'openai-chat'),
    ).toMatchObject({ anthropicLane: false });
  });

  it('refuses a bare id two connectors share, and a model not allowed', () => {
    expect(
      matchRelayModel(ORG, 'shared-id', allowed, 'openai-chat'),
    ).toBeNull();
    expect(matchRelayModel(ORG, 'gpt-6', allowed, 'openai-chat')).toBeNull();
    expect(
      matchRelayModel(ORG, 'openai/claude-sonnet-5-5', allowed, 'openai-chat'),
    ).toBeNull();
    // Another organization's record of the same model is not this one's.
    expect(
      matchRelayModel(
        ORG,
        'org_2__deepseek__deepseek-v4__anthropic/deepseek-v4',
        allowed,
        'anthropic',
      ),
    ).toBeNull();
  });

  it('lists the full names, once each', () => {
    expect(
      listedModels(ORG, [
        { providerSlug: 'anthropic', modelId: 'claude-sonnet-5-5' },
        { providerSlug: 'anthropic', modelId: 'claude-sonnet-5-5' },
        { providerSlug: 'acme', modelId: 'a/b' },
      ]),
    ).toEqual(['anthropic/claude-sonnet-5-5', 'org_1__acme__a_b/a/b']);
  });
});
