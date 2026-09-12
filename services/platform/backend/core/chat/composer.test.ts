// @vitest-environment node

/**
 * Every model's `label` was a verbatim copy of its `id`, so a picker built
 * from the catalogue showed `glm-5v-turbo` where a person expects
 * "GLM 5v Turbo" — and every integrator kept a hand-made id→name table that
 * drifted the moment the catalogue changed. The humaniser is the fallback
 * for a catalog that publishes no display name.
 */

import { describe, expect, it } from 'vitest';

import { collectComposerOptions, humaniseModelId } from './composer';

describe('humaniseModelId', () => {
  it.each([
    ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
    ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
    ['glm-5.3-flash', 'GLM 5.3 Flash'],
    ['glm-5v-turbo', 'GLM 5v Turbo'],
    ['glm-5.3', 'GLM 5.3'],
    ['gpt-4o-mini', 'GPT 4o Mini'],
    ['gpt-5.5', 'GPT 5.5'],
    ['claude-fable-5', 'Claude Fable 5'],
    ['qwen3-coder', 'Qwen3 Coder'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['grok-4', 'Grok 4'],
    ['kimi-k2', 'Kimi K2'],
    ['z-ai/glm-5.3', 'GLM 5.3'],
    ['o3-mini', 'O3 Mini'],
  ])('reads %s as "%s"', (id, label) => {
    expect(humaniseModelId(id)).toBe(label);
  });

  it('leaves an id it cannot split as it is', () => {
    expect(humaniseModelId('---')).toBe('---');
  });
});

describe('collectComposerOptions', () => {
  it('labels each chat model with the humanised id, the id itself untouched', () => {
    const hit = {
      connector: {
        name: 'zai',
        displayName: 'Z.ai (GLM)',
        apiFormat: 'openai',
      },
      credential: { authMethod: 'api-key' },
      credentialAuth: { authMethod: 'api-key' as const },
      entry: {
        id: 'glm-5v-turbo',
        provider: 'zai',
        tags: ['chat'],
        supportsTools: true,
        supportsVision: true,
        contextWindow: 128_000,
      },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the walk's hit shape, narrowed to what the projection reads
    const { byId } = collectComposerOptions([hit as never]);
    expect(byId.get('zai glm-5v-turbo')).toMatchObject({
      id: 'glm-5v-turbo',
      label: 'GLM 5v Turbo',
      providerLabel: 'Z.ai (GLM)',
    });
  });
});
