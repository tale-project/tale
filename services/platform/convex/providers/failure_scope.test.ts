import { describe, expect, it } from 'vitest';

import {
  credentialScopeKey,
  endpointScopeKey,
  isModelScopeRetired,
  modelScopeKeys,
  retiredScopeKey,
} from './failure_scope';

const model = (
  over: Partial<{ providerName: string; apiKey: string; baseUrl: string }> = {},
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
  it('retires the CREDENTIAL for funds and auth failures', () => {
    expect(retiredScopeKey('credit_exhausted', model())).toBe(
      credentialScopeKey(model()),
    );
    expect(retiredScopeKey('auth_error', model())).toBe(
      credentialScopeKey(model()),
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

  it('exposes both scopes a model belongs to', () => {
    expect(modelScopeKeys(model())).toEqual([
      credentialScopeKey(model()),
      endpointScopeKey(model()),
    ]);
  });
});
