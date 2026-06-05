import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  envSecret,
  envSecretStatus,
  providerHasEnvKey,
  resolveApiKey,
} from './secret_resolver';

const ALLOWLIST = 'TALE_PROVIDER_SECRET_ENV_ALLOWLIST';

// Snapshot and restore the env vars these tests touch so cases don't leak.
const TOUCHED = [ALLOWLIST, 'OPENAI_API_KEY', 'MODEL_KEY', 'PROVIDER_KEY'];

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

  describe('envSecret — allowlist gate', () => {
    it('returns null when the allowlist is empty (feature locked)', () => {
      process.env.OPENAI_API_KEY = 'sk-live';
      expect(envSecret('OPENAI_API_KEY')).toBeNull();
    });

    it('returns null when the name is not in the allowlist', () => {
      process.env[ALLOWLIST] = 'OTHER_KEY';
      process.env.OPENAI_API_KEY = 'sk-live';
      expect(envSecret('OPENAI_API_KEY')).toBeNull();
    });

    it('resolves when the name is allowlisted and set', () => {
      process.env[ALLOWLIST] = 'OPENAI_API_KEY, OTHER_KEY';
      process.env.OPENAI_API_KEY = 'sk-live';
      expect(envSecret('OPENAI_API_KEY')).toBe('sk-live');
    });

    it('returns null for an allowlisted but empty/whitespace env var', () => {
      process.env[ALLOWLIST] = 'OPENAI_API_KEY';
      process.env.OPENAI_API_KEY = '   ';
      expect(envSecret('OPENAI_API_KEY')).toBeNull();
    });

    it('returns null for an undefined name', () => {
      expect(envSecret(undefined)).toBeNull();
    });

    it('trims the resolved env value (trailing-newline footgun)', () => {
      process.env[ALLOWLIST] = 'OPENAI_API_KEY';
      process.env.OPENAI_API_KEY = 'sk-live\n';
      expect(envSecret('OPENAI_API_KEY')).toBe('sk-live');
    });
  });

  describe('resolveApiKey — precedence', () => {
    it('prefers model env over provider env over file', () => {
      process.env[ALLOWLIST] = 'MODEL_KEY,PROVIDER_KEY';
      process.env.MODEL_KEY = 'sk-model';
      process.env.PROVIDER_KEY = 'sk-provider';
      expect(
        resolveApiKey({
          modelSecretsEnv: 'MODEL_KEY',
          providerSecretsEnv: 'PROVIDER_KEY',
          fileModelKey: 'sk-file-model',
          fileApiKey: 'sk-file-provider',
        }),
      ).toBe('sk-model');
    });

    it('falls from empty model env to provider env', () => {
      process.env[ALLOWLIST] = 'MODEL_KEY,PROVIDER_KEY';
      process.env.PROVIDER_KEY = 'sk-provider';
      expect(
        resolveApiKey({
          modelSecretsEnv: 'MODEL_KEY', // not set → falls through
          providerSecretsEnv: 'PROVIDER_KEY',
          fileApiKey: 'sk-file',
        }),
      ).toBe('sk-provider');
    });

    it('falls through to file when no env resolves', () => {
      process.env[ALLOWLIST] = 'MODEL_KEY';
      expect(
        resolveApiKey({
          modelSecretsEnv: 'MODEL_KEY', // allowlisted but unset
          fileModelKey: 'sk-file-model',
          fileApiKey: 'sk-file-provider',
        }),
      ).toBe('sk-file-model');
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
      process.env[ALLOWLIST] = 'PROVIDER_KEY';
      process.env.PROVIDER_KEY = 'sk';
      expect(
        providerHasEnvKey({ secretsEnv: 'PROVIDER_KEY', models: [] }),
      ).toBe(true);
    });

    it('is true for a resolving model-level env (any model)', () => {
      process.env[ALLOWLIST] = 'MODEL_KEY';
      process.env.MODEL_KEY = 'sk';
      expect(
        providerHasEnvKey({
          models: [{}, { secretsEnv: 'MODEL_KEY' }],
        }),
      ).toBe(true);
    });

    it('is false when nothing resolves (allowlist locked)', () => {
      process.env.PROVIDER_KEY = 'sk'; // not allowlisted
      expect(
        providerHasEnvKey({
          secretsEnv: 'PROVIDER_KEY',
          models: [{ secretsEnv: 'MODEL_KEY' }],
        }),
      ).toBe(false);
    });
  });

  describe('envSecretStatus — UI, no value', () => {
    it('reports not-configured for an unset name', () => {
      expect(envSecretStatus(undefined)).toEqual({
        allowlisted: false,
        resolved: false,
      });
    });

    it('distinguishes not-allowlisted from configured-but-empty', () => {
      process.env.OPENAI_API_KEY = 'sk';
      expect(envSecretStatus('OPENAI_API_KEY')).toEqual({
        name: 'OPENAI_API_KEY',
        allowlisted: false,
        resolved: false,
      });

      process.env[ALLOWLIST] = 'OPENAI_API_KEY';
      delete process.env.OPENAI_API_KEY;
      expect(envSecretStatus('OPENAI_API_KEY')).toEqual({
        name: 'OPENAI_API_KEY',
        allowlisted: true,
        resolved: false,
      });
    });

    it('reports resolved when allowlisted and set', () => {
      process.env[ALLOWLIST] = 'OPENAI_API_KEY';
      process.env.OPENAI_API_KEY = 'sk';
      expect(envSecretStatus('OPENAI_API_KEY')).toEqual({
        name: 'OPENAI_API_KEY',
        allowlisted: true,
        resolved: true,
      });
    });
  });
});
