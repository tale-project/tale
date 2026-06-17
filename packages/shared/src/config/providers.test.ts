import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getChatModel, loadProviders } from './providers.ts';

const PROVIDER_ENV = 'TALE_PROVIDER_KEY_OPENROUTER';
const MODEL_ENV = 'TALE_PROVIDER_KEY_MODEL';
const PROVIDER_ENV2 = 'TALE_PROVIDER_KEY_PROVIDER';
const NON_PREFIXED = 'OPENROUTER_API_KEY';
const ORG = 'default';

let configDir: string;

interface WriteProviderOptions {
  providerSecretsEnv?: string | null;
  modelSecretsEnv?: string | null;
  fileApiKey?: string | null;
  name?: string;
}

function writeProvider(options: WriteProviderOptions = {}): void {
  const {
    providerSecretsEnv,
    modelSecretsEnv,
    fileApiKey,
    name = 'openrouter',
  } = options;
  const providersDir = path.join(configDir, ORG, 'providers');
  mkdirSync(providersDir, { recursive: true });

  const model: Record<string, unknown> = {
    id: 'chat-model',
    displayName: 'Chat',
    tags: ['chat'],
  };
  if (modelSecretsEnv !== undefined && modelSecretsEnv !== null) {
    model.secretsEnv = modelSecretsEnv;
  }

  const config: Record<string, unknown> = {
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.example/v1',
    models: [model],
  };
  if (providerSecretsEnv !== undefined && providerSecretsEnv !== null) {
    config.secretsEnv = providerSecretsEnv;
  }

  writeFileSync(
    path.join(providersDir, `${name}.json`),
    JSON.stringify(config),
  );
  if (fileApiKey !== undefined && fileApiKey !== null) {
    writeFileSync(
      path.join(providersDir, `${name}.secrets.json`),
      JSON.stringify({ apiKey: fileApiKey }),
    );
  }
}

beforeEach(() => {
  configDir = mkdtempSync(path.join(tmpdir(), 'providers-'));
  // Isolate from any real env that could route the loader elsewhere.
  vi.stubEnv('TALE_PLATFORM_SHARED_CONFIG_DIR', '');
  vi.stubEnv('TALE_CONFIG_DIR', '');
  vi.stubEnv('CONFIG_DIR', '');
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('provider API-key resolution', () => {
  it('resolves an env-only provider via a prefixed env var', () => {
    writeProvider({ providerSecretsEnv: PROVIDER_ENV });
    vi.stubEnv(PROVIDER_ENV, 'sk-env');
    const { baseUrl, apiKey, modelId } = getChatModel(ORG, configDir);
    expect(apiKey).toBe('sk-env');
    expect(modelId).toBe('chat-model');
    expect(baseUrl).toBe('https://openrouter.example/v1');
  });

  it('falls back to the file key when the env name is not prefixed', () => {
    writeProvider({ providerSecretsEnv: NON_PREFIXED, fileApiKey: 'sk-file' });
    vi.stubEnv(NON_PREFIXED, 'sk-env');
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-file');
  });

  it('prefers the env var over the file key', () => {
    writeProvider({ providerSecretsEnv: PROVIDER_ENV, fileApiKey: 'sk-file' });
    vi.stubEnv(PROVIDER_ENV, 'sk-env');
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-env');
  });

  it('falls back to the file key when the prefixed env var is empty', () => {
    writeProvider({ providerSecretsEnv: PROVIDER_ENV, fileApiKey: 'sk-file' });
    vi.stubEnv(PROVIDER_ENV, '   ');
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-file');
  });

  it('trims the env value', () => {
    writeProvider({ providerSecretsEnv: PROVIDER_ENV });
    vi.stubEnv(PROVIDER_ENV, 'sk-env\n');
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-env');
  });

  it('prefers the model env over the provider env', () => {
    writeProvider({
      providerSecretsEnv: PROVIDER_ENV2,
      modelSecretsEnv: MODEL_ENV,
    });
    vi.stubEnv(MODEL_ENV, 'sk-model');
    vi.stubEnv(PROVIDER_ENV2, 'sk-provider');
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-model');
  });

  it('returns an empty string when no key resolves', () => {
    writeProvider();
    expect(getChatModel(ORG, configDir).apiKey).toBe('');
  });

  it('parses secretsEnv onto the provider/model configs', () => {
    writeProvider({
      providerSecretsEnv: PROVIDER_ENV2,
      modelSecretsEnv: MODEL_ENV,
    });
    const providers = loadProviders(ORG, configDir);
    expect(providers).toHaveLength(1);
    expect(providers[0].secretsEnv).toBe(PROVIDER_ENV2);
    expect(providers[0].models[0].secretsEnv).toBe(MODEL_ENV);
  });

  it('degrades a non-string secretsEnv to the file key', () => {
    const providersDir = path.join(configDir, ORG, 'providers');
    mkdirSync(providersDir, { recursive: true });
    const config = {
      displayName: 'OpenRouter',
      baseUrl: 'https://openrouter.example/v1',
      secretsEnv: 123,
      models: [
        {
          id: 'chat-model',
          displayName: 'Chat',
          tags: ['chat'],
          secretsEnv: ['nope'],
        },
      ],
    };
    writeFileSync(
      path.join(providersDir, 'openrouter.json'),
      JSON.stringify(config),
    );
    writeFileSync(
      path.join(providersDir, 'openrouter.secrets.json'),
      JSON.stringify({ apiKey: 'sk-file' }),
    );
    expect(getChatModel(ORG, configDir).apiKey).toBe('sk-file');
  });
});
