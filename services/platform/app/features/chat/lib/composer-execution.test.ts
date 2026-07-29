import { describe, expect, it } from 'vitest';

import type { ModelCatalogEntry } from '@/lib/shared/schemas/providers';

import { resolveSandboxAffordance } from './composer-execution';

const model: ModelCatalogEntry = {
  id: 'anthropic/claude-fable-5',
  provider: 'openrouter',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200_000,
};

describe('resolveSandboxAffordance', () => {
  it('leaves the toggle free for a platform-held key', () => {
    expect(resolveSandboxAffordance(model, { authMethod: 'api-key' })).toEqual({
      locked: false,
    });
    expect(resolveSandboxAffordance(model, { authMethod: 'env' })).toEqual({
      locked: false,
    });
  });

  it('locks the toggle on and names the harness for a subscription key', () => {
    expect(
      resolveSandboxAffordance(model, {
        authMethod: 'subscription-key',
        constraints: { execution: 'sandbox', harness: 'claude-code' },
      }),
    ).toEqual({ locked: true, harness: 'claude-code' });
  });

  it('locks the toggle on for a brokered subscription token too', () => {
    expect(
      resolveSandboxAffordance(model, {
        authMethod: 'subscription-broker',
        constraints: { execution: 'sandbox', harness: 'codex' },
      }),
    ).toEqual({ locked: true, harness: 'codex' });
  });
});
