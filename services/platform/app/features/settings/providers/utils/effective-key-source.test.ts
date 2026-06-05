import { describe, expect, it } from 'vitest';

import { computeEffectiveKeyState } from './effective-key-source';

describe('computeEffectiveKeyState', () => {
  it('reports env-resolving when the env var is set and resolves (env shadows the stored key)', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: {
          name: 'TALE_PROVIDER_KEY_OPENAI',
          allowed: true,
          resolved: true,
        },
        hasSecret: true,
      }),
    ).toBe('env-resolving');
  });

  it('reports env-unresolved-fallback when the env var is configured but unset and a stored key exists', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: {
          name: 'TALE_PROVIDER_KEY_OPENAI',
          allowed: true,
          resolved: false,
        },
        hasSecret: true,
      }),
    ).toBe('env-unresolved-fallback');
  });

  it('reports env-unresolved-no-file when the env var is configured but unset and no stored key exists', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: {
          name: 'TALE_PROVIDER_KEY_OPENAI',
          allowed: true,
          resolved: false,
        },
        hasSecret: false,
      }),
    ).toBe('env-unresolved-no-file');
  });

  it('reports env-not-prefixed when the env var name violates the reserved prefix', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: {
          name: 'OPENAI_API_KEY',
          allowed: false,
          resolved: false,
        },
        hasSecret: true,
      }),
    ).toBe('env-not-prefixed');
  });

  it('reports stored-only when there is no env var and a stored key exists', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: undefined,
        hasSecret: true,
      }),
    ).toBe('stored-only');
  });

  it('reports none when neither source is configured', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: undefined,
        hasSecret: false,
      }),
    ).toBe('none');
  });

  it('treats an env status without a name as no env override', () => {
    expect(
      computeEffectiveKeyState({
        providerEnvStatus: { name: undefined, allowed: false, resolved: false },
        hasSecret: true,
      }),
    ).toBe('stored-only');
  });
});
