import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  buildCustomProviderDefinition,
  mapProviderDefinitionError,
  slugifyProviderName,
  uniqueProviderSlug,
} from './provider-definition-form';

const t = (key: string, options?: Record<string, unknown>) =>
  options === undefined ? key : `${key}:${JSON.stringify(options)}`;

const stored: ProviderDefinition = {
  name: 'internal-gateway',
  displayName: 'Internal gateway',
  apiFormat: 'openai',
  wireDialect: 'openai-modern',
  baseUrl: 'https://models.example.test/v1',
  harnessEndpoint: {
    baseUrl: 'https://models.example.test/anthropic',
    apiFormat: 'anthropic',
  },
  catalog: { source: 'models-endpoint' },
  embedding: 'unsupported',
  auth: [
    { method: 'api-key' },
    { method: 'env' },
    {
      method: 'subscription-key',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
};

describe('slugifyProviderName', () => {
  it('turns a display name into the schema slug', () => {
    expect(slugifyProviderName('Internal vLLM (EU)')).toBe('internal-vllm-eu');
    expect(slugifyProviderName('  Ünïcode  Name ')).toBe('unicode-name');
    expect(slugifyProviderName('---')).toBe('');
    expect(slugifyProviderName('a'.repeat(70)).length).toBe(64);
    expect(slugifyProviderName(`${'a'.repeat(63)}-b`)).toBe('a'.repeat(63));
  });
});

describe('uniqueProviderSlug', () => {
  it('numbers a slug past the shipped and existing providers, and names a nameless one', () => {
    const taken = new Set(['openai', 'qwen-cn', 'qwen-cn-2']);
    expect(uniqueProviderSlug('Qwen CN', taken)).toBe('qwen-cn-3');
    expect(uniqueProviderSlug('OpenAI', taken)).toBe('openai-2');
    expect(uniqueProviderSlug('Local vLLM', taken)).toBe('local-vllm');
    expect(uniqueProviderSlug('***', taken)).toBe('custom-provider');
    // The suffix never pushes the slug past the schema's 64 characters.
    const long = 'a'.repeat(64);
    expect(uniqueProviderSlug(long, new Set([long]))).toBe(
      `${'a'.repeat(62)}-2`,
    );
  });
});

describe('buildCustomProviderDefinition', () => {
  it('emits only what the dialog collected for a new provider', () => {
    expect(
      buildCustomProviderDefinition({
        name: 'local-models',
        displayName: ' Local models ',
        apiFormat: 'anthropic',
        baseUrl: ' https://models.example.test/v1 ',
        catalogSource: 'none',
      }),
    ).toEqual({
      ok: true,
      config: {
        name: 'local-models',
        displayName: 'Local models',
        apiFormat: 'anthropic',
        baseUrl: 'https://models.example.test/v1',
        catalog: { source: 'none' },
        auth: [{ method: 'api-key' }, { method: 'env' }],
      },
    });
  });

  it('keeps the facts the dialog has no field for through an edit, except a dialect the new wire refuses', () => {
    const kept = buildCustomProviderDefinition(
      {
        name: stored.name,
        displayName: 'Renamed gateway',
        apiFormat: 'openai',
        baseUrl: 'https://models.example.test/v2',
        catalogSource: 'models-endpoint',
      },
      stored,
    );
    expect(kept).toEqual({
      ok: true,
      config: {
        ...stored,
        displayName: 'Renamed gateway',
        baseUrl: 'https://models.example.test/v2',
      },
    });
    const rewired = buildCustomProviderDefinition(
      {
        name: stored.name,
        displayName: stored.displayName,
        apiFormat: 'anthropic',
        baseUrl: stored.baseUrl ?? '',
        catalogSource: 'models-endpoint',
      },
      stored,
    );
    expect(rewired).toMatchObject({ ok: true });
    if (!rewired.ok) throw new Error('unreachable');
    expect(rewired.config.wireDialect).toBeUndefined();
    expect(rewired.config.harnessEndpoint).toEqual(stored.harnessEndpoint);
    expect(rewired.config.auth).toEqual(stored.auth);
  });

  it('refuses a plain-http public endpoint and keeps a private one', () => {
    const publicHttp = buildCustomProviderDefinition({
      name: 'local',
      displayName: 'Local',
      apiFormat: 'openai',
      baseUrl: 'http://models.example.test/v1',
      catalogSource: 'models-endpoint',
    });
    expect(publicHttp.ok).toBe(false);
    if (publicHttp.ok) throw new Error('unreachable');
    expect(publicHttp.message).toMatch(/https/);
    expect(
      buildCustomProviderDefinition({
        name: 'local',
        displayName: 'Local',
        apiFormat: 'openai',
        baseUrl: 'http://192.168.1.20:8000/v1',
        catalogSource: 'models-endpoint',
      }),
    ).toMatchObject({
      ok: true,
      config: { baseUrl: 'http://192.168.1.20:8000/v1' },
    });
  });
});

describe('mapProviderDefinitionError', () => {
  it('names the fix for each coded refusal and keeps the server sentence otherwise', () => {
    const coded = (code: string) =>
      new AppError({ code, message: `server says ${code}` });
    expect(mapProviderDefinitionError(t, coded('PROVIDER_NAME_RESERVED'))).toBe(
      'providers.custom.errors.nameReserved',
    );
    expect(
      mapProviderDefinitionError(t, coded('PROVIDER_ENDPOINT_INVALID')),
    ).toBe('providers.custom.errors.endpointNotPermitted');
    expect(mapProviderDefinitionError(t, coded('PROVIDER_IN_USE'))).toBe(
      'providers.custom.errors.inUse',
    );
    expect(
      mapProviderDefinitionError(t, coded('CONFIG_VERSION_CONFLICT')),
    ).toBe('providers.custom.errors.versionConflict');
    expect(mapProviderDefinitionError(t, coded('CONFIG_UNREADABLE'))).toBe(
      'server says CONFIG_UNREADABLE',
    );
    expect(mapProviderDefinitionError(t, new Error('boom'))).toBe('boom');
  });
});
