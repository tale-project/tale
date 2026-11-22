import { describe, expect, it } from 'vitest';

import {
  carriedOptions,
  isSealed,
  mergeCarried,
  providerOptionsOf,
  seal,
  unseal,
} from './carry.ts';

describe('what the relay carries through a client for its provider', () => {
  it('keeps only the fields a provider asks to have back', () => {
    expect(
      carriedOptions({
        anthropic: { signature: 'sig-1', cacheCreationInputTokens: 12 },
        google: { thoughtSignature: 'ts-1', safetyRatings: 'x' },
        openai: { itemId: 'rs_1' },
      }),
    ).toEqual({
      anthropic: { signature: 'sig-1' },
      google: { thoughtSignature: 'ts-1' },
    });
    expect(carriedOptions({ openai: { itemId: 'rs_1' } })).toBeUndefined();
    // The OpenAI-compatible package reports Google's signature under the
    // provider's own name, and reads it back from google.
    expect(carriedOptions({ upstream: { thoughtSignature: 'ts-2' } })).toEqual({
      google: { thoughtSignature: 'ts-2' },
    });
    expect(carriedOptions('not metadata')).toBeUndefined();
    expect(carriedOptions({ anthropic: { signature: '' } })).toBeUndefined();
    expect(
      carriedOptions({ anthropic: { signature: 'x'.repeat(64 * 1024 + 1) } }),
    ).toBeUndefined();
  });

  it('seals a thinking part’s fields, its text and its calls, and unseals them as they were', () => {
    const carried = {
      options: { anthropic: { signature: 'sig-1' } },
      text: 'Let me think about the files.',
      calls: { call_1: { google: { thoughtSignature: 'ts-1' } } },
    };
    const sealed = seal(carried);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed?.startsWith('tale-relay.v1:')).toBe(true);
    expect(unseal(sealed)).toEqual(carried);
    expect(providerOptionsOf(unseal(sealed))).toEqual({
      anthropic: { signature: 'sig-1' },
    });
    expect(providerOptionsOf(unseal(sealed), 'call_1')).toEqual({
      google: { thoughtSignature: 'ts-1' },
    });
    expect(providerOptionsOf(unseal(sealed), 'call_2')).toBeUndefined();
    expect(providerOptionsOf(unseal(sealed), 'constructor')).toBeUndefined();
    expect(providerOptionsOf(unseal(sealed), 'toString')).toBeUndefined();
  });

  it('seals nothing when the provider asked for nothing back', () => {
    expect(seal(undefined)).toBeUndefined();
    expect(seal({ text: 'thought, unsigned' })).toBeUndefined();
    expect(seal({ calls: { call_1: {} } })).toBeUndefined();
  });

  it('gives back nothing for a value that is not the relay’s, or does not read', () => {
    expect(unseal('EqQBCkgIAxABGAIiQL…anthropic-signature')).toBeUndefined();
    expect(unseal('tale-relay.v1:%%%')).toBeUndefined();
    expect(
      unseal(`tale-relay.v1:${Buffer.from('[1,2]').toString('base64url')}`),
    ).toBeUndefined();
    expect(unseal(42)).toBeUndefined();
  });

  it('reaches no field outside the allowlist, whatever a client writes into the carrier', () => {
    const forged = `tale-relay.v1:${Buffer.from(
      JSON.stringify({
        o: {
          anthropic: { signature: 'sig', cacheControl: 'x' },
          openai: { store: 'true' },
        },
        c: {
          __proto__: { anthropic: { signature: 'x' } },
          call_1: { anthropic: { mcpServers: 'x' } },
        },
      }),
    ).toString('base64url')}`;
    expect(unseal(forged)).toEqual({
      options: { anthropic: { signature: 'sig' } },
    });
  });

  it('merges what the start and the end of one thinking part each say', () => {
    expect(
      mergeCarried(
        { anthropic: { redactedData: 'r' } },
        { anthropic: { signature: 's' } },
      ),
    ).toEqual({ anthropic: { redactedData: 'r', signature: 's' } });
    expect(mergeCarried(undefined, undefined)).toBeUndefined();
  });
});
