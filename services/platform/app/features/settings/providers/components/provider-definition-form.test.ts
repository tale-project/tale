import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { AppError } from '@/lib/shared/errors/app-error';

import {
  buildCustomProviderDefinition,
  catalogFailureText,
  contextWindowOf,
  declaredModels,
  mapProviderDefinitionError,
  modelFactsComplete,
  modelFactsDraft,
  modelFactsDrafts,
  sameModelFacts,
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
        allowlist: ['qwen3-32b'],
        modelFacts: {},
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
        allowlist: [],
        modelFacts: {},
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
        allowlist: [],
        modelFacts: {},
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
      allowlist: [],
      modelFacts: {},
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
        allowlist: [],
        modelFacts: {},
      }),
    ).toMatchObject({
      ok: true,
      config: { baseUrl: 'http://192.168.1.20:8000/v1' },
    });
  });
});

describe('the models a provider without a listing declares', () => {
  /** An organization's own Anthropic-format gateway, as its file stands. */
  const gateway: ProviderDefinition = {
    name: 'claude-gateway',
    displayName: 'Claude gateway',
    apiFormat: 'anthropic',
    baseUrl: 'https://llm.example.test',
    catalog: {
      source: 'none',
      models: [
        { id: 'claude-legacy-gw', contextWindow: 32_768 },
        { id: 'claude-sonnet-gw', contextWindow: 200_000 },
        { id: 'claude-haiku-gw', supportsVision: true },
      ],
    },
    auth: [{ method: 'api-key' }, { method: 'env' }],
  };
  const edit = (
    allowlist: string[],
    modelFacts: Record<
      string,
      { contextWindow: string; supportsVision: boolean }
    >,
    catalogSource: 'none' | 'models-endpoint' = 'none',
  ) =>
    buildCustomProviderDefinition(
      {
        name: gateway.name,
        displayName: gateway.displayName,
        apiFormat: gateway.apiFormat,
        baseUrl: gateway.baseUrl ?? '',
        catalogSource,
        allowlist,
        modelFacts,
      },
      gateway,
    );

  it('declares what was typed for each allowlisted id, and nothing for a blank one', () => {
    expect(
      buildCustomProviderDefinition({
        name: 'claude-gateway',
        displayName: 'Claude gateway',
        apiFormat: 'anthropic',
        baseUrl: 'https://llm.example.test',
        catalogSource: 'none',
        allowlist: ['claude-sonnet-gw', 'claude-haiku-gw', 'claude-opus-gw'],
        modelFacts: {
          'claude-sonnet-gw': {
            contextWindow: '1000000',
            supportsVision: true,
          },
          'claude-haiku-gw': {
            contextWindow: ' 200000 ',
            supportsVision: false,
          },
          'claude-opus-gw': { contextWindow: '', supportsVision: false },
          // Typed for an id since removed from the allowlist: not shown, so
          // not declared.
          'claude-removed-gw': { contextWindow: '64000', supportsVision: true },
        },
      }),
    ).toMatchObject({
      ok: true,
      config: {
        catalog: {
          source: 'none',
          models: [
            {
              id: 'claude-sonnet-gw',
              contextWindow: 1_000_000,
              supportsVision: true,
            },
            { id: 'claude-haiku-gw', contextWindow: 200_000 },
          ],
        },
      },
    });
  });

  it('keeps the stored declaration of an id the dialog does not show, in place', () => {
    const saved = edit(
      ['claude-sonnet-gw', 'claude-haiku-gw', 'claude-new-gw'],
      {
        'claude-sonnet-gw': { contextWindow: '1000000', supportsVision: true },
        // Cleared in the dialog: the declaration goes.
        'claude-haiku-gw': { contextWindow: '', supportsVision: false },
        'claude-new-gw': { contextWindow: '65536', supportsVision: false },
      },
    );
    expect(saved).toMatchObject({ ok: true });
    if (!saved.ok) throw new Error('unreachable');
    expect(saved.config.catalog).toEqual({
      source: 'none',
      models: [
        { id: 'claude-legacy-gw', contextWindow: 32_768 },
        {
          id: 'claude-sonnet-gw',
          contextWindow: 1_000_000,
          supportsVision: true,
        },
        { id: 'claude-new-gw', contextWindow: 65_536 },
      ],
    });
  });

  it('declares no models once the provider lists its own', () => {
    const saved = edit(
      ['claude-sonnet-gw'],
      {
        'claude-sonnet-gw': { contextWindow: '1000000', supportsVision: true },
      },
      'models-endpoint',
    );
    expect(saved).toMatchObject({
      ok: true,
      config: { catalog: { source: 'models-endpoint' } },
    });
  });

  it('refuses a window that is not a whole number of tokens', () => {
    expect(
      edit(['claude-sonnet-gw'], {
        'claude-sonnet-gw': { contextWindow: '1.5', supportsVision: false },
      }).ok,
    ).toBe(false);
  });

  it('reads a typed window as tokens, blank as no declaration', () => {
    expect(contextWindowOf('')).toBeUndefined();
    expect(contextWindowOf('   ')).toBeUndefined();
    expect(contextWindowOf(' 200000 ')).toBe(200_000);
    for (const typed of [
      '0',
      '-5',
      '1e5',
      '12.5',
      'abc',
      '99999999999999999999',
    ])
      expect(contextWindowOf(typed)).toBeNull();
  });

  it('holds the save only for a shown model whose window is unreadable', () => {
    const drafts = {
      'claude-sonnet-gw': { contextWindow: '200000', supportsVision: false },
      'claude-removed-gw': { contextWindow: 'abc', supportsVision: false },
    };
    expect(modelFactsComplete(['claude-sonnet-gw'], drafts)).toBe(true);
    expect(
      modelFactsComplete(['claude-sonnet-gw', 'claude-removed-gw'], drafts),
    ).toBe(false);
  });

  it('compares the shown models by what they declare', () => {
    const seeded = modelFactsDrafts(
      gateway.catalog.source === 'none' ? gateway.catalog.models : [],
    );
    expect(seeded['claude-sonnet-gw']).toEqual({
      contextWindow: '200000',
      supportsVision: false,
    });
    expect(
      sameModelFacts(['claude-sonnet-gw', 'claude-opus-gw'], seeded, {
        ...seeded,
        'claude-sonnet-gw': { contextWindow: ' 200000', supportsVision: false },
        'claude-opus-gw': { contextWindow: '', supportsVision: false },
      }),
    ).toBe(true);
    expect(
      sameModelFacts(['claude-sonnet-gw'], seeded, {
        'claude-sonnet-gw': { contextWindow: '200000', supportsVision: true },
      }),
    ).toBe(false);
  });

  it('reads a model id as an id, never as a property of every object', () => {
    expect(modelFactsDraft({}, 'constructor')).toEqual({
      contextWindow: '',
      supportsVision: false,
    });
    const drafts = modelFactsDrafts([{ id: '__proto__', contextWindow: 8192 }]);
    expect(Object.hasOwn(drafts, '__proto__')).toBe(true);
    expect(modelFactsDraft(drafts, '__proto__').contextWindow).toBe('8192');
    expect(declaredModels([], ['__proto__'], drafts)).toEqual([
      { id: '__proto__', contextWindow: 8192 },
    ]);
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
    expect(mapProviderDefinitionError(t, coded('CREDENTIAL_IN_USE'))).toBe(
      'providers.credential.inUseByEmbedding',
    );
    expect(
      mapProviderDefinitionError(t, coded('CREDENTIAL_ACCOUNT_ID_INVALID')),
    ).toBe('providers.credential.accountIdInvalid');
    expect(
      mapProviderDefinitionError(t, coded('CONFIG_VERSION_CONFLICT')),
    ).toBe('providers.custom.errors.versionConflict');
    expect(mapProviderDefinitionError(t, coded('CONFIG_UNREADABLE'))).toBe(
      'server says CONFIG_UNREADABLE',
    );
    expect(mapProviderDefinitionError(t, new Error('boom'))).toBe('boom');
  });

  it('reads the code of a failed listing check, which answers 502', () => {
    const failed = (code: string) =>
      new BackendApiError(
        502,
        'The selected provider catalog is unavailable.',
        code,
      );
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_NOT_JSON')),
    ).toBe('providers.custom.errors.catalogNotJson');
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_NOT_FOUND')),
    ).toBe('providers.custom.errors.catalogNotFound');
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_KEY_REFUSED')),
    ).toBe('providers.custom.errors.catalogKeyRefused');
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_UPSTREAM_ERROR')),
    ).toBe('providers.custom.errors.catalogUpstreamError');
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_UNREACHABLE')),
    ).toBe('providers.custom.errors.catalogUnreachable');
    expect(
      mapProviderDefinitionError(t, failed('PROVIDER_CATALOG_UNAVAILABLE')),
    ).toBe('providers.custom.errors.catalogUnavailable');
  });
});

describe('catalogFailureText', () => {
  it('names the fix for a listing that answered without a model list, never its words, which name the URL', () => {
    expect(
      catalogFailureText(
        t,
        'catalog fetch got text/html instead of JSON from https://gw.example/models',
        'PROVIDER_CATALOG_NOT_JSON',
      ),
    ).toBe('providers.custom.errors.catalogNotJson');
    expect(
      catalogFailureText(
        t,
        'catalog fetch returned HTTP 404: https://gw.example/models lists no models',
        'PROVIDER_CATALOG_NOT_FOUND',
      ),
    ).toBe('providers.custom.errors.catalogNotFound');
  });

  it.each([
    [
      'PROVIDER_CATALOG_KEY_REFUSED',
      'catalog fetch returned HTTP 401',
      'providers.custom.errors.catalogKeyRefused',
    ],
    [
      'PROVIDER_CATALOG_UPSTREAM_ERROR',
      'catalog fetch returned HTTP 503',
      'providers.custom.errors.catalogUpstreamError',
    ],
    [
      'PROVIDER_CATALOG_UNREACHABLE',
      'Request timed out after 20000ms',
      'providers.custom.errors.catalogUnreachable',
    ],
  ] as const)(
    'reads %s as its sentence, the server words after it',
    (code, error, sentence) => {
      expect(catalogFailureText(t, error, code)).toBe(
        `providers.catalogs.failureDetail:${JSON.stringify({ sentence, detail: error })}`,
      );
    },
  );

  it('reads a failure without a code as the general sentence, never its words', () => {
    expect(
      catalogFailureText(
        t,
        'Unexpected token \'<\', "<!doctype "... is not valid JSON',
        undefined,
      ),
    ).toBe('providers.custom.errors.catalogUnavailable');
  });
});
