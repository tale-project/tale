import { describe, expect, it } from 'vitest';

import {
  creditScopeKey,
  credentialScopeKey,
  endpointScopeKey,
  isFreeModel,
  isModelScopeRetired,
  modelScopeKeys,
  retiredScopeKey,
} from './failure_scope';

const model = (
  over: Partial<{
    providerName: string;
    apiKey: string;
    baseUrl: string;
    modelId: string;
    inputCentsPerMillion: number;
    outputCentsPerMillion: number;
  }> = {},
) => ({
  providerName: 'openrouter',
  apiKey: 'key-A',
  baseUrl: 'https://openrouter.ai/api/v1',
  ...over,
});

describe('credentialScopeKey', () => {
  it('is identical for the same provider + key', () => {
    expect(credentialScopeKey(model())).toBe(credentialScopeKey(model()));
  });

  it('differs when the key differs (same provider)', () => {
    expect(credentialScopeKey(model({ apiKey: 'key-A' }))).not.toBe(
      credentialScopeKey(model({ apiKey: 'key-B' })),
    );
  });

  it('does not contain the raw key', () => {
    expect(
      credentialScopeKey(model({ apiKey: 'super-secret-123' })),
    ).not.toContain('super-secret-123');
  });
});

describe('endpointScopeKey', () => {
  it('is provider + baseUrl scoped', () => {
    expect(endpointScopeKey(model())).toBe(
      endpointScopeKey(model({ apiKey: 'different-key' })),
    );
    expect(endpointScopeKey(model({ baseUrl: 'https://a' }))).not.toBe(
      endpointScopeKey(model({ baseUrl: 'https://b' })),
    );
  });
});

describe('retiredScopeKey', () => {
  it('retires the AUTH credential for an auth failure', () => {
    expect(retiredScopeKey('auth_error', model())).toBe(
      credentialScopeKey(model()),
    );
  });

  it('retires the CREDIT credential for an out-of-funds failure', () => {
    expect(retiredScopeKey('credit_exhausted', model())).toBe(
      creditScopeKey(model()),
    );
  });

  it('retires the ENDPOINT for an unreachable host', () => {
    expect(retiredScopeKey('provider_unreachable', model())).toBe(
      endpointScopeKey(model()),
    );
  });

  it('retires nothing for transient or model-scoped failures', () => {
    expect(retiredScopeKey('provider_error', model())).toBeNull();
    expect(retiredScopeKey('rate_limited', model())).toBeNull();
    expect(retiredScopeKey('model_not_found', model())).toBeNull();
    expect(retiredScopeKey('generic', model())).toBeNull();
  });
});

describe('isModelScopeRetired', () => {
  it('skips a sibling that shares the dead credential', () => {
    const dead = new Set([credentialScopeKey(model({ apiKey: 'shared' }))]);
    expect(isModelScopeRetired(model({ apiKey: 'shared' }), dead)).toBe(true);
  });

  it('does NOT skip a sibling on the same provider with a different key', () => {
    const dead = new Set([credentialScopeKey(model({ apiKey: 'key-A' }))]);
    // Same provider + baseUrl, different key → independent credential.
    expect(isModelScopeRetired(model({ apiKey: 'key-B' }), dead)).toBe(false);
  });

  it('skips every model on a dead endpoint regardless of key', () => {
    const dead = new Set([endpointScopeKey(model())]);
    expect(isModelScopeRetired(model({ apiKey: 'any-other-key' }), dead)).toBe(
      true,
    );
  });

  it('returns false against an empty dead-set', () => {
    expect(isModelScopeRetired(model(), new Set())).toBe(false);
  });

  it('exposes both unconditional scopes a model belongs to', () => {
    expect(modelScopeKeys(model())).toEqual([
      credentialScopeKey(model()),
      endpointScopeKey(model()),
    ]);
  });

  describe('credit retirement spares zero-cost siblings (#1454)', () => {
    it('still skips a PAID model on a credit-dead credential', () => {
      const dead = new Set([creditScopeKey(model())]);
      expect(
        isModelScopeRetired(
          model({ modelId: 'openai/gpt-4o', inputCentsPerMillion: 250 }),
          dead,
        ),
      ).toBe(true);
    });

    it('does NOT skip a `:free` sibling on a credit-dead credential', () => {
      const dead = new Set([creditScopeKey(model())]);
      expect(
        isModelScopeRetired(
          model({ modelId: 'meta-llama/llama-3.3-70b-instruct:free' }),
          dead,
        ),
      ).toBe(false);
    });

    it('does NOT skip a zero-priced sibling on a credit-dead credential', () => {
      const dead = new Set([creditScopeKey(model())]);
      expect(
        isModelScopeRetired(
          model({ inputCentsPerMillion: 0, outputCentsPerMillion: 0 }),
          dead,
        ),
      ).toBe(false);
    });

    it('STILL skips a free model when the credential died from AUTH', () => {
      // A bad/expired key kills free models too — only credit exhaustion spares them.
      const dead = new Set([credentialScopeKey(model())]);
      expect(isModelScopeRetired(model({ modelId: 'x/y:free' }), dead)).toBe(
        true,
      );
    });

    it('STILL skips a free model when the endpoint is unreachable', () => {
      const dead = new Set([endpointScopeKey(model())]);
      expect(isModelScopeRetired(model({ modelId: 'x/y:free' }), dead)).toBe(
        true,
      );
    });
  });
});

describe('isFreeModel', () => {
  it('treats the OpenRouter `:free` suffix as free', () => {
    expect(isFreeModel(model({ modelId: 'deepseek/deepseek-r1:free' }))).toBe(
      true,
    );
  });

  it('treats explicit zero token pricing on both sides as free', () => {
    expect(
      isFreeModel(model({ inputCentsPerMillion: 0, outputCentsPerMillion: 0 })),
    ).toBe(true);
  });

  it('does NOT treat unconfigured pricing as free', () => {
    expect(isFreeModel(model({ modelId: 'openai/gpt-4o' }))).toBe(false);
  });

  it('does NOT treat a paid model as free', () => {
    expect(
      isFreeModel(
        model({ inputCentsPerMillion: 250, outputCentsPerMillion: 1000 }),
      ),
    ).toBe(false);
  });
});
