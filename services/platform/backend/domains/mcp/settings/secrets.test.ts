import { describe, expect, it } from 'vitest';

import {
  isMaskedSecret,
  maskSecrets,
  restoreMaskedSecrets,
  secretArgumentRefusal,
  secretPlaces,
} from './secrets';

/** A fake stored secret, long enough for an excerpt. */
const SENTINEL = 'SENTINEL-stored-secret-0001';
/** A fake credential an agent might paste. */
const PASTED = 'sk-000000000000000000000000';

const PATHS = ['/apiKey', '/endpoint/headers/*', '/clients/*/secret'];

const stored = {
  name: 'vendor',
  apiKey: SENTINEL,
  endpoint: {
    url: 'https://vendor.example.invalid',
    headers: { 'X-Key': SENTINEL },
  },
  clients: [{ id: 'a', secret: SENTINEL }, { id: 'b' }],
};

describe('secret places', () => {
  it('names every place a path reaches, a * standing for each member or index', () => {
    expect(secretPlaces(stored, PATHS).sort()).toEqual([
      '/apiKey',
      '/clients/0/secret',
      '/endpoint/headers/X-Key',
    ]);
    expect(secretPlaces({ name: 'x' }, PATHS)).toEqual([]);
  });
});

describe('masking what is answered', () => {
  it('masks every secret with an excerpt and leaves the rest as stored', () => {
    const masked = maskSecrets(stored, PATHS);
    expect(masked).toEqual({
      name: 'vendor',
      apiKey: { masked: true, preview: 'SENT…01' },
      endpoint: {
        url: 'https://vendor.example.invalid',
        headers: { 'X-Key': { masked: true, preview: 'SENT…01' } },
      },
      clients: [
        { id: 'a', secret: { masked: true, preview: 'SENT…01' } },
        { id: 'b' },
      ],
    });
    expect(JSON.stringify(masked)).not.toContain(SENTINEL);
    // The stored value itself is never changed.
    expect(stored.apiKey).toBe(SENTINEL);
  });

  it('shows nothing of a short or non-text secret, and keeps a value already masked', () => {
    expect(
      maskSecrets({ apiKey: 'short', other: 1 }, ['/apiKey', '/other']),
    ).toEqual({
      apiKey: { masked: true, preview: '••••' },
      other: { masked: true },
    });
    const already = { apiKey: { masked: true, preview: 'sk-o…Z2' } };
    expect(maskSecrets(already, ['/apiKey'])).toEqual(already);
  });

  it('tells a masked value from anything else', () => {
    expect(isMaskedSecret({ masked: true })).toBe(true);
    expect(isMaskedSecret({ masked: true, preview: 'x' })).toBe(true);
    expect(isMaskedSecret({ masked: true, value: SENTINEL })).toBe(false);
    expect(isMaskedSecret({ masked: 'true' })).toBe(false);
    expect(isMaskedSecret(SENTINEL)).toBe(false);
  });
});

describe('refusing a secret a change carries', () => {
  it('refuses a value in a secret’s place, naming where and never the value', () => {
    const refusal = secretArgumentRefusal(
      { config: { name: 'vendor', apiKey: 'a-new-key-typed-in' } },
      ['/apiKey'],
    );
    expect(refusal).toEqual({
      error: 'a secret value at /config/apiKey: no secret travels through MCP',
      code: 'SECRET_ARGUMENT_REFUSED',
      hint: expect.stringContaining('masked value'),
      data: { places: [{ pointer: '/config/apiKey', kind: 'a secret value' }] },
    });
    expect(JSON.stringify(refusal)).not.toContain('a-new-key-typed-in');
  });

  it('takes the masked value back in a secret’s place', () => {
    expect(
      secretArgumentRefusal({ config: maskSecrets(stored, PATHS) }, PATHS),
    ).toBeNull();
  });

  it('refuses a credential pasted anywhere else, in the config or the arguments', () => {
    const refusal = secretArgumentRefusal(
      {
        config: { description: `use ${PASTED} for now` },
        args: { note: PASTED },
      },
      [],
    );
    expect(refusal?.code).toBe('SECRET_ARGUMENT_REFUSED');
    expect(refusal?.data).toEqual({
      places: [
        { pointer: '/config/description', kind: 'API key (sk-…)' },
        { pointer: '/args/note', kind: 'API key (sk-…)' },
      ],
    });
    expect(refusal?.error).toBe(
      'API key (sk-…) at /config/description (and 1 more): no secret travels through MCP',
    );
    expect(JSON.stringify(refusal)).not.toContain(PASTED);
  });

  it('refuses a credential smuggled into a masked value’s preview', () => {
    const refusal = secretArgumentRefusal(
      { config: { apiKey: { masked: true, preview: PASTED } } },
      ['/apiKey'],
    );
    expect(refusal?.data).toEqual({
      places: [{ pointer: '/config/apiKey/preview', kind: 'API key (sk-…)' }],
    });
  });

  it('lets a change through that carries no secret', () => {
    expect(
      secretArgumentRefusal(
        { config: { name: 'vendor', timeoutMs: 3000 } },
        PATHS,
      ),
    ).toBeNull();
  });
});

describe('keeping a stored secret through a masked value', () => {
  it('puts back what is stored wherever the change sends the mask', () => {
    const sent = maskSecrets({ ...stored, name: 'renamed' }, PATHS);
    expect(restoreMaskedSecrets(sent, stored, PATHS)).toEqual({
      config: { ...stored, name: 'renamed' },
    });
  });

  it('leaves the mask for the writer where the native read itself only masks', () => {
    const readMasked = { apiKey: { masked: true, preview: 'SENT…01' } };
    expect(
      restoreMaskedSecrets({ apiKey: { masked: true } }, readMasked, [
        '/apiKey',
      ]),
    ).toEqual({ config: { apiKey: { masked: true } } });
  });

  it('refuses a mask where nothing is stored to keep', () => {
    const outcome = restoreMaskedSecrets({ apiKey: { masked: true } }, null, [
      '/apiKey',
    ]);
    expect(outcome).toEqual({
      refusal: expect.objectContaining({
        code: 'SECRET_ARGUMENT_REFUSED',
        data: {
          places: [
            { pointer: '/config/apiKey', kind: 'nothing stored to keep' },
          ],
        },
      }),
    });
  });
});
