import { describe, expect, it } from 'vitest';

import {
  isMaskedSecret,
  maskedPlaces,
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

describe('a credential stored where no secret belongs', () => {
  // A person can paste a key into a policy's header or an instruction in
  // Tale; a read over MCP never answers it.
  const policy = {
    enabled: true,
    endpoint: {
      url: 'https://moderation.example.invalid',
      headers: { Authorization: `Bearer ${PASTED}`, Accept: 'json' },
    },
    note: `the old key was ${PASTED}`,
  };

  it('is masked wherever the detector finds it, beside the secrets a path names [MCP-R12]', () => {
    expect(maskedPlaces(policy, []).sort()).toEqual([
      '/endpoint/headers/Authorization',
      '/note',
    ]);
    const masked = maskSecrets(policy, []);
    expect(JSON.stringify(masked)).not.toContain(PASTED);
    expect(masked).toMatchObject({
      enabled: true,
      endpoint: {
        url: 'https://moderation.example.invalid',
        headers: {
          Authorization: { masked: true },
          Accept: 'json',
        },
      },
      note: { masked: true },
    });
  });

  it('is kept when a change sends its mask back, and its mask is taken nowhere else [MCP-R12]', () => {
    const sent = maskSecrets({ ...policy, enabled: false }, []);
    expect(restoreMaskedSecrets(sent, policy, [])).toEqual({
      config: { ...policy, enabled: false },
    });
    const elsewhere = {
      ...policy,
      endpoint: { ...policy.endpoint, url: { masked: true } },
    };
    expect(restoreMaskedSecrets(elsewhere, policy, [])).toEqual({
      refusal: expect.objectContaining({
        code: 'SECRET_ARGUMENT_REFUSED',
        data: {
          places: [
            { pointer: '/config/endpoint/url', kind: 'nothing stored to keep' },
          ],
        },
      }),
    });
  });
});

/**
 * Credentials the run recorder withholds from people, assembled at run time
 * so no scanner reads this file as holding one.
 */
const WITHHELD = {
  google: ['AIza', 'SyA', '0'.repeat(32)].join(''),
  payment: ['sk', 'live', '0'.repeat(24)].join('_'),
  githubFineGrained: ['github', 'pat', `11A${'0'.repeat(30)}`].join('_'),
  gitlab: ['glpat', '0'.repeat(20)].join('-'),
  webToken: [
    'eyJhbGciOiJIUzI1NiJ9',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
    'c2lnbmF0dXJlLXZhbHVlLXZhbHVl',
  ].join('.'),
};

/** Opaque values a header holds, of the shape vendors issue. */
const HEADER_VALUE = '0123456789abcdef0123456789abcdef';

/** A moderation provider configured in Tale with its keys typed into the
 * headers and the address, beside the headers that name the stored secret. */
const moderation = {
  enabled: true,
  endpoint: {
    url: 'https://bot:s3cretpassw0rd@moderation.example.invalid/v1',
    headers: {
      'Ocp-Apim-Subscription-Key': HEADER_VALUE,
      'x-api-key': HEADER_VALUE,
      'X-Goog-Api-Key': WITHHELD.google,
      client_secret: `GOCSPX-${HEADER_VALUE}`,
      access_token: `ya29.${HEADER_VALUE}`,
      Authorization: 'Bearer {{secret}}',
      'X-Signature-Key': '{{secret}}',
      'Content-Type': 'application/json',
    },
    requestTemplate: '{"input": {{text}}}',
  },
};

describe('a credential the run recorder would withhold [MCP-R12]', () => {
  it('is masked under every header that names a key, and in an address that carries a password', () => {
    expect(maskedPlaces(moderation, []).sort()).toEqual([
      '/endpoint/headers/Ocp-Apim-Subscription-Key',
      '/endpoint/headers/X-Goog-Api-Key',
      '/endpoint/headers/access_token',
      '/endpoint/headers/client_secret',
      '/endpoint/headers/x-api-key',
      '/endpoint/url',
    ]);
    const masked = maskSecrets(moderation, []);
    for (const value of [HEADER_VALUE, WITHHELD.google, 's3cretpassw0rd']) {
      expect(JSON.stringify(masked)).not.toContain(value);
    }
    // A header that only names the secret Tale stores keeps showing it.
    expect(masked).toMatchObject({
      endpoint: {
        headers: {
          Authorization: 'Bearer {{secret}}',
          'X-Signature-Key': '{{secret}}',
          'Content-Type': 'application/json',
        },
        requestTemplate: '{"input": {{text}}}',
      },
    });
  });

  it.each(Object.entries(WITHHELD))(
    'masks a %s pasted into an instruction, and refuses one in a change',
    (_shape, credential) => {
      const config = {
        projectId: 'p1',
        instructions: `Use ${credential} for the calls.`,
      };
      expect(maskSecrets(config, [])).toEqual({
        projectId: 'p1',
        instructions: { masked: true, preview: 'Use …s.' },
      });
      const refusal = secretArgumentRefusal({ config }, []);
      expect(refusal?.data).toEqual({
        places: [{ pointer: '/config/instructions', kind: expect.any(String) }],
      });
      expect(JSON.stringify(refusal)).not.toContain(credential);
    },
  );

  it('refuses a key typed into a header or an address, and takes a header that names the stored secret', () => {
    const refusal = secretArgumentRefusal({ config: moderation }, []);
    expect(refusal?.code).toBe('SECRET_ARGUMENT_REFUSED');
    const typed = [
      '/config/endpoint/headers/Ocp-Apim-Subscription-Key',
      '/config/endpoint/headers/X-Goog-Api-Key',
      '/config/endpoint/headers/access_token',
      '/config/endpoint/headers/client_secret',
      '/config/endpoint/headers/x-api-key',
      '/config/endpoint/url',
    ];
    expect(refusal?.data?.places).toHaveLength(typed.length);
    expect(refusal?.data?.places).toEqual(
      expect.arrayContaining(
        typed.map((pointer) => expect.objectContaining({ pointer })),
      ),
    );
    expect(
      secretArgumentRefusal(
        {
          config: {
            endpoint: {
              url: 'https://moderation.example.invalid/v1',
              headers: {
                Authorization: 'Bearer {{secret}}',
                'Ocp-Apim-Subscription-Key': '{{secret}}',
              },
            },
          },
        },
        [],
      ),
    ).toBeNull();
  });

  it('keeps every masked header when the read is sent back', () => {
    const sent = maskSecrets({ ...moderation, enabled: false }, []);
    expect(secretArgumentRefusal({ config: sent }, [])).toBeNull();
    expect(restoreMaskedSecrets(sent, moderation, [])).toEqual({
      config: { ...moderation, enabled: false },
    });
  });

  it('judges a field its kind declares by its text alone', () => {
    const provider = { name: 'local', auth: [{ method: 'api-key' }] };
    const embedding = {
      providerSlug: 'local',
      credentialId: 'c2f5e0b4-5d0e-4c3c-9f4e-2f1d0b9a7e61',
      maxTokensPerMinute: 60_000,
    };
    const declared = new Set([
      'name',
      'auth',
      'method',
      'providerSlug',
      'credentialId',
      'maxTokensPerMinute',
    ]);
    expect(maskedPlaces(provider, [], declared)).toEqual([]);
    expect(maskedPlaces(embedding, [], declared)).toEqual([]);
    expect(
      secretArgumentRefusal({ config: embedding }, [], declared),
    ).toBeNull();
    // Undeclared, the same members read as secrets by their names.
    expect(maskedPlaces(provider, [])).toEqual(['/auth']);
    expect(maskedPlaces(embedding, [])).toEqual(['/credentialId']);
    // A declared field still holds no credential.
    expect(
      maskedPlaces(
        { ...embedding, credentialId: WITHHELD.gitlab },
        [],
        declared,
      ),
    ).toEqual(['/credentialId']);
  });
});
