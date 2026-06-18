import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MissingApiKeyError, shouldFailoverToNextModel } from './errors';
import { resolvedModelDataValidator, selectModelByTag } from './file_actions';

// Issue #1711 regression: a provider can be kept loaded by ONE model's env key
// (`providerHasEnvKey` is provider-OR-any-model). `selectModelByTag` must skip a
// tag-matching model whose key does not resolve and surface a usable sibling,
// rather than throwing on the first keyless hit — the throw is terminal on the
// transcription/TTS paths, which resolve via this function with no failover.

const ENV_A = 'TALE_PROVIDER_KEY_A';
const ENV_B = 'TALE_PROVIDER_KEY_B';
const PROVIDER_ENV = 'TALE_PROVIDER_KEY_PROVIDER';
const TOUCHED = [ENV_A, ENV_B, PROVIDER_ENV];

type Candidates = Parameters<typeof selectModelByTag>[0];

function provider(opts: {
  name: string;
  secretsEnv?: string;
  defaults?: Record<string, string>;
  fileApiKey?: string;
  models: Array<{ id: string; tags: string[]; secretsEnv?: string }>;
}): Candidates[number] {
  return {
    name: opts.name,
    config: {
      displayName: opts.name,
      baseUrl: `https://${opts.name}.example/v1`,
      secretsEnv: opts.secretsEnv,
      defaults: opts.defaults,
      models: opts.models.map((m) => ({
        id: m.id,
        displayName: m.id,
        tags: m.tags,
        secretsEnv: m.secretsEnv,
      })),
    },
    secrets: opts.fileApiKey != null ? { apiKey: opts.fileApiKey } : null,
    // The function only reads the fields above; cast away the rest of the
    // ProviderJson/ProviderSecrets surface for this focused unit test.
  } as unknown as Candidates[number];
}

describe('selectModelByTag — keyless-skip resolution (#1711)', () => {
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

  it('skips a keyless first tag-match and resolves the sibling with an env key', () => {
    process.env[ENV_B] = 'sk-b';
    const candidates: Candidates = [
      provider({
        name: 'openrouter',
        models: [
          { id: 'a', tags: ['chat'] }, // keyless
          { id: 'b', tags: ['chat'], secretsEnv: ENV_B }, // env key
        ],
      }),
    ];
    const result = selectModelByTag(candidates, 'chat', undefined);
    expect(result.modelId).toBe('b');
    expect(result.apiKey).toBe('sk-b');
  });

  it('skips a keyless per-tag default and falls through to a usable sibling', () => {
    process.env[ENV_B] = 'sk-b';
    const candidates: Candidates = [
      provider({
        name: 'openrouter',
        defaults: { chat: 'a' }, // default points at the keyless model
        models: [
          { id: 'a', tags: ['chat'] },
          { id: 'b', tags: ['chat'], secretsEnv: ENV_B },
        ],
      }),
    ];
    const result = selectModelByTag(candidates, 'chat', undefined);
    expect(result.modelId).toBe('b');
    expect(result.apiKey).toBe('sk-b');
  });

  it('resolves a sibling on a DIFFERENT provider when the first provider is keyless', () => {
    process.env[ENV_B] = 'sk-b';
    const candidates: Candidates = [
      provider({ name: 'first', models: [{ id: 'a', tags: ['chat'] }] }),
      provider({
        name: 'second',
        models: [{ id: 'b', tags: ['chat'], secretsEnv: ENV_B }],
      }),
    ];
    const result = selectModelByTag(candidates, 'chat', undefined);
    expect(result.providerName).toBe('second');
    expect(result.modelId).toBe('b');
  });

  it('resolves via the provider-level env key for a model without its own', () => {
    process.env[PROVIDER_ENV] = 'sk-provider';
    const candidates: Candidates = [
      provider({
        name: 'openrouter',
        secretsEnv: PROVIDER_ENV,
        models: [{ id: 'a', tags: ['chat'] }],
      }),
    ];
    const result = selectModelByTag(candidates, 'chat', undefined);
    expect(result.modelId).toBe('a');
    expect(result.apiKey).toBe('sk-provider');
  });

  it('throws the failover-eligible MissingApiKeyError when every tag match is keyless', () => {
    const candidates: Candidates = [
      provider({
        name: 'openrouter',
        models: [
          { id: 'a', tags: ['chat'] },
          { id: 'b', tags: ['chat'], secretsEnv: ENV_B }, // env var NOT set
        ],
      }),
    ];
    let thrown: unknown;
    try {
      selectModelByTag(candidates, 'chat', undefined);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingApiKeyError);
    // The whole point of throwing this (not UNKNOWN_MODEL): a fallback model on
    // another provider may still resolve, so failover must continue.
    expect(shouldFailoverToNextModel(thrown)).toBe(true);
  });

  it('throws UNKNOWN_MODEL when no model carries the tag at all', () => {
    process.env[ENV_A] = 'sk-a';
    const candidates: Candidates = [
      provider({
        name: 'openrouter',
        models: [{ id: 'a', tags: ['embedding'], secretsEnv: ENV_A }],
      }),
    ];
    expect(() => selectModelByTag(candidates, 'chat', undefined)).toThrow(
      ConvexError,
    );
  });
});

describe('resolvedModelDataValidator', () => {
  // Regression guard: `requestBodyMap` is a TOP-LEVEL field, so it is stripped
  // at the ctx.runAction boundary (tag/id resolution) unless it's in this closed
  // validator. Dropping it here would silently disable the wire transform on the
  // V8/tag paths while the in-process chat path keeps working — hard to spot.
  it('carries requestBodyMap so it survives action-boundary serialization', () => {
    expect(resolvedModelDataValidator.fields).toHaveProperty('requestBodyMap');
  });
});
