import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  buildProviderDefinition,
  emptyProviderDefinitionForm,
  mapProviderDefinitionError,
  providerDefinitionFromForm,
  providerDefinitionToForm,
  slugifyProviderName,
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

describe('provider definition form projections', () => {
  it('round-trips a stored definition through the fields, keeping the facts the form has no field for', () => {
    const values = providerDefinitionToForm(stored);
    expect(values).toEqual({
      displayName: 'Internal gateway',
      name: 'internal-gateway',
      apiFormat: 'openai',
      baseUrl: 'https://models.example.test/v1',
      catalogSource: 'models-endpoint',
      authMethods: ['api-key', 'env'],
      modernOpenAiWire: true,
      perCredentialEndpoint: false,
      harnessEndpointUrl: 'https://models.example.test/anthropic',
      harnessEndpointFormat: 'anthropic',
    });
    // The subscription entry and the embedding claim ride along unchanged.
    expect(providerDefinitionFromForm(values, stored)).toEqual(stored);
  });

  it('emits only what the fields say for a new definition', () => {
    const built = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: ' Local models ',
      name: 'local-models',
      baseUrl: ' https://models.example.test/v1 ',
      authMethods: ['env'],
      // Ignored for the anthropic wire: the dialect refines openai only.
      apiFormat: 'anthropic',
      modernOpenAiWire: true,
    });
    expect(built).toEqual({
      ok: true,
      config: {
        name: 'local-models',
        displayName: 'Local models',
        apiFormat: 'anthropic',
        baseUrl: 'https://models.example.test/v1',
        catalog: { source: 'models-endpoint' },
        auth: [{ method: 'env' }],
      },
    });
  });

  it('lets a per-credential provider omit the base URL, and names the schema refusal otherwise', () => {
    const perCredential = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: 'Azure-like',
      name: 'azure-like',
      perCredentialEndpoint: true,
      catalogSource: 'none',
    });
    expect(perCredential).toMatchObject({
      ok: true,
      config: { endpointMode: 'per-credential', catalog: { source: 'none' } },
    });
    const listingNeedsUrl = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: 'Azure-like',
      name: 'azure-like',
      perCredentialEndpoint: true,
    });
    expect(listingNeedsUrl).toMatchObject({ ok: false });
    if (listingNeedsUrl.ok) throw new Error('unreachable');
    expect(listingNeedsUrl.message).toMatch(/models-endpoint catalog/);
    const noAuth = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: 'Local',
      name: 'local',
      baseUrl: 'https://models.example.test/v1',
      authMethods: [],
    });
    expect(noAuth.ok).toBe(false);
  });

  it('rejects a plain-http public endpoint but keeps a private one', () => {
    const publicHttp = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: 'Local',
      name: 'local',
      baseUrl: 'http://models.example.test/v1',
    });
    expect(publicHttp.ok).toBe(false);
    const privateHttp = buildProviderDefinition({
      ...emptyProviderDefinitionForm(),
      displayName: 'Local',
      name: 'local',
      baseUrl: 'http://192.168.1.20:8000/v1',
    });
    expect(privateHttp).toMatchObject({
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
