import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  envSecret,
  envSecretStatus,
  providerHasEnvKey,
  resolveApiKey,
} from './secret_resolver';

const PREFIXED = 'TALE_PROVIDER_KEY_OPENAI';
const MODEL_ENV = 'TALE_PROVIDER_KEY_MODEL';
const PROVIDER_ENV = 'TALE_PROVIDER_KEY_PROVIDER';
// A name outside the reserved prefix — must never resolve.
const NON_PREFIXED = 'OPENAI_API_KEY';

// Snapshot and restore the env vars these tests touch so cases don't leak.
const TOUCHED = [PREFIXED, MODEL_ENV, PROVIDER_ENV, NON_PREFIXED];

describe('secret_resolver', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of TOUCHED) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe('envSecret — reserved-prefix gate', () => {
    it('resolves when the name is prefixed and set', () => {
      process.env[PREFIXED] = 'sk-live';
      expect(envSecret(PREFIXED)).toBe('sk-live');
    });

    it('returns null when the name is not prefixed', () => {
      process.env[NON_PREFIXED] = 'sk-live';
      expect(envSecret(NON_PREFIXED)).toBeNull();
    });

    it('returns null for a prefixed but empty/whitespace env var', () => {
      process.env[PREFIXED] = '   ';
      expect(envSecret(PREFIXED)).toBeNull();
    });

    it('returns null for an undefined name', () => {
      expect(envSecret(undefined)).toBeNull();
    });

    it('trims the resolved env value (trailing-newline footgun)', () => {
      process.env[PREFIXED] = 'sk-live\n';
      expect(envSecret(PREFIXED)).toBe('sk-live');
    });
  });

  describe('resolveApiKey — precedence', () => {
    it('prefers model env over provider env over file', () => {
      process.env[MODEL_ENV] = 'sk-model';
      process.env[PROVIDER_ENV] = 'sk-provider';
      expect(
        resolveApiKey({
          modelSecretsEnv: MODEL_ENV,
          providerSecretsEnv: PROVIDER_ENV,
          fileModelKey: 'sk-file-model',
          fileApiKey: 'sk-file-provider',
        }),
      ).toBe('sk-model');
    });

    it('falls from empty model env to provider env', () => {
      process.env[PROVIDER_ENV] = 'sk-provider';
      expect(
        resolveApiKey({
          modelSecretsEnv: MODEL_ENV, // not set → falls through
          providerSecretsEnv: PROVIDER_ENV,
          fileApiKey: 'sk-file',
        }),
      ).toBe('sk-provider');
    });

    it('falls through to file when no env resolves', () => {
      expect(
        resolveApiKey({
          modelSecretsEnv: MODEL_ENV, // prefixed but unset
          fileModelKey: 'sk-file-model',
          fileApiKey: 'sk-file-provider',
        }),
      ).toBe('sk-file-model');
    });

    it('falls through to file when the env name is not prefixed', () => {
      process.env[NON_PREFIXED] = 'sk-env';
      expect(
        resolveApiKey({
          providerSecretsEnv: NON_PREFIXED,
          fileApiKey: 'sk-file-provider',
        }),
      ).toBe('sk-file-provider');
    });

    it('uses file apiKey when no model file key', () => {
      expect(resolveApiKey({ fileApiKey: 'sk-file-provider' })).toBe(
        'sk-file-provider',
      );
    });

    it('does NOT trim file tiers (byte-identical to current behavior)', () => {
      expect(resolveApiKey({ fileApiKey: '  sk-padded  ' })).toBe(
        '  sk-padded  ',
      );
    });

    it('returns null when nothing resolves', () => {
      expect(resolveApiKey({})).toBeNull();
    });
  });

  describe('providerHasEnvKey', () => {
    it('is true for a resolving provider-level env', () => {
      process.env[PROVIDER_ENV] = 'sk';
      expect(providerHasEnvKey({ secretsEnv: PROVIDER_ENV, models: [] })).toBe(
        true,
      );
    });

    it('is true for a resolving model-level env (any model)', () => {
      process.env[MODEL_ENV] = 'sk';
      expect(
        providerHasEnvKey({
          models: [{}, { secretsEnv: MODEL_ENV }],
        }),
      ).toBe(true);
    });

    it('is false when the names are not prefixed', () => {
      process.env[NON_PREFIXED] = 'sk'; // set but not prefixed
      expect(
        providerHasEnvKey({
          secretsEnv: NON_PREFIXED,
          models: [{ secretsEnv: MODEL_ENV }],
        }),
      ).toBe(false);
    });
  });

  describe('envSecretStatus — UI, no value', () => {
    it('reports not-configured for an unset name', () => {
      expect(envSecretStatus(undefined)).toEqual({
        allowed: false,
        resolved: false,
      });
    });

    it('distinguishes not-prefixed from configured-but-empty', () => {
      process.env[NON_PREFIXED] = 'sk';
      expect(envSecretStatus(NON_PREFIXED)).toEqual({
        name: NON_PREFIXED,
        allowed: false,
        resolved: false,
      });

      // Prefixed but the env var is unset.
      expect(envSecretStatus(PREFIXED)).toEqual({
        name: PREFIXED,
        allowed: true,
        resolved: false,
      });
    });

    it('reports resolved when prefixed and set', () => {
      process.env[PREFIXED] = 'sk';
      expect(envSecretStatus(PREFIXED)).toEqual({
        name: PREFIXED,
        allowed: true,
        resolved: true,
      });
    });
  });
});
