import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCallProviderOptions,
  mergeModelLevel,
  stripDenyListed,
} from './provider_options';

describe('mergeModelLevel', () => {
  it('returns undefined when both sides are absent', () => {
    expect(mergeModelLevel(undefined, undefined)).toBeUndefined();
  });

  it('returns provider-level when model-level is absent', () => {
    expect(
      mergeModelLevel({ provider: { allow_fallbacks: false } }, undefined),
    ).toEqual({ provider: { allow_fallbacks: false } });
  });

  it('returns model-level when provider-level is absent', () => {
    expect(
      mergeModelLevel(undefined, { provider: { quantizations: ['fp8'] } }),
    ).toEqual({ provider: { quantizations: ['fp8'] } });
  });

  it('depth-2 merges nested plain objects with model winning on conflict', () => {
    expect(
      mergeModelLevel(
        { provider: { allow_fallbacks: false, data_collection: 'deny' } },
        { provider: { quantizations: ['fp8'], data_collection: 'allow' } },
      ),
    ).toEqual({
      provider: {
        allow_fallbacks: false,
        data_collection: 'allow',
        quantizations: ['fp8'],
      },
    });
  });

  it('replaces arrays wholesale (no concat)', () => {
    expect(
      mergeModelLevel(
        { provider: { only: ['Together', 'Fireworks'] } },
        { provider: { only: ['Hyperbolic'] } },
      ),
    ).toEqual({ provider: { only: ['Hyperbolic'] } });
  });

  it('does not recurse below depth 2 (depth-3 values replace wholesale)', () => {
    expect(
      mergeModelLevel(
        { provider: { max_price: { prompt: 1, completion: 5 } } },
        { provider: { max_price: { prompt: 2 } } },
      ),
    ).toEqual({ provider: { max_price: { prompt: 2 } } });
  });

  it('treats undefined sub-values as absent (other side wins)', () => {
    expect(
      mergeModelLevel(
        { provider: { allow_fallbacks: false } },
        { provider: { allow_fallbacks: undefined } },
      ),
    ).toEqual({ provider: { allow_fallbacks: false } });
  });

  it('treats null as a real value that replaces', () => {
    expect(
      mergeModelLevel(
        { provider: { allow_fallbacks: false } },
        { provider: { allow_fallbacks: null } },
      ),
    ).toEqual({ provider: { allow_fallbacks: null } });
  });

  it('prunes top-level keys whose value is the empty object', () => {
    expect(mergeModelLevel({ provider: {} }, { provider: {} })).toBeUndefined();
  });

  it('prunes empty top-level keys but preserves non-empty siblings', () => {
    expect(
      mergeModelLevel(
        { provider: { allow_fallbacks: false }, ignored: {} },
        undefined,
      ),
    ).toEqual({ provider: { allow_fallbacks: false } });
  });

  it('replaces wholesale when one side is an object and the other is a primitive', () => {
    expect(
      mergeModelLevel({ provider: { only: ['x'] } }, { provider: 'forbidden' }),
    ).toEqual({ provider: 'forbidden' });
  });
});

describe('stripDenyListed', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns undefined for undefined input', () => {
    expect(stripDenyListed(undefined)).toBeUndefined();
  });

  it('strips top-level body-overwrite keys with a warning', () => {
    expect(
      stripDenyListed({ provider: { quantizations: ['fp8'] }, model: 'evil' }),
    ).toEqual({ provider: { quantizations: ['fp8'] } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'model'"));
  });

  it('strips SDK-reserved keys with a warning', () => {
    expect(
      stripDenyListed({ provider: {}, reasoningEffort: 'high' }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'reasoningEffort'"),
    );
  });

  it('strips deny-listed keys nested one level deep', () => {
    expect(
      stripDenyListed({
        openrouter: { provider: { quantizations: ['fp8'] }, model: 'evil' },
      }),
    ).toEqual({
      openrouter: { provider: { quantizations: ['fp8'] } },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("'openrouter.model'"),
    );
  });

  it('preserves non-deny-listed keys verbatim', () => {
    expect(
      stripDenyListed({ provider: { quantizations: ['fp8'], order: ['T'] } }),
    ).toEqual({ provider: { quantizations: ['fp8'], order: ['T'] } });
  });
});

describe('buildCallProviderOptions', () => {
  it('returns undefined when no providerOptions are configured', () => {
    expect(
      buildCallProviderOptions({ providerName: 'openrouter' }),
    ).toBeUndefined();
  });

  it('returns undefined when providerOptions is the empty object', () => {
    expect(
      buildCallProviderOptions({
        providerName: 'openrouter',
        providerOptions: {},
      }),
    ).toBeUndefined();
  });

  it('namespaces under the kebab providerName', () => {
    expect(
      buildCallProviderOptions({
        providerName: 'vercel-gateway',
        providerOptions: { provider: { quantizations: ['fp8'] } },
      }),
    ).toEqual({
      'vercel-gateway': { provider: { quantizations: ['fp8'] } },
    });
  });

  it('applies the deny-list strip before namespacing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        buildCallProviderOptions({
          providerName: 'openrouter',
          providerOptions: {
            provider: { quantizations: ['fp8'] },
            model: 'evil',
            max_tokens: 999_999,
          },
        }),
      ).toEqual({
        openrouter: { provider: { quantizations: ['fp8'] } },
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
