import { afterEach, describe, expect, test } from 'bun:test';

import { parseInstanceInput } from './identity';
import { resolveManagedOidc, resolveSignIn } from './identity-selection';
import { deploymentSpecSchema } from './model';

const KEYS = [
  'EXAMPLE_ENTRA_TENANT',
  'EXAMPLE_ENTRA_CLIENT',
  'EXAMPLE_ENTRA_SECRET',
  'EXAMPLE_OIDC_ISSUER',
  'EXAMPLE_OIDC_CLIENT',
  'EXAMPLE_OIDC_SECRET',
];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of KEYS)
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
});
const set = (values: Record<string, string>) => {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
};
const ENTRA_ENV = {
  EXAMPLE_ENTRA_TENANT: '11111111-1111-4111-8111-111111111111',
  EXAMPLE_ENTRA_CLIENT: 'entra-client-private',
  EXAMPLE_ENTRA_SECRET: 'entra-secret-private',
};
const OIDC_ENV = {
  EXAMPLE_OIDC_ISSUER: 'https://id.example.org',
  EXAMPLE_OIDC_CLIENT: 'oidc-client-private',
  EXAMPLE_OIDC_SECRET: 'oidc-secret-private',
};

const reference = (env: string, optional: boolean) => ({
  env,
  ...(optional ? { optional } : {}),
});
function identity(options: {
  entra?: boolean;
  oidc?: boolean | Record<string, unknown>;
  optional?: boolean;
}) {
  const optional = options.optional ?? false;
  const spec = deploymentSpecSchema.parse({
    schemaVersion: 1,
    name: 'north-labs',
    stateDirectory: '/var/lib/north-labs',
    composeProject: 'tale',
    runtime: { revision: 'b'.repeat(40) },
    origin: 'https://desk.north-labs.example',
    tlsMode: 'external',
    identity: {
      email: 'operator@example.org',
      slug: 'north-labs',
      name: 'North Labs',
      ssoEnabled: true,
      ...(options.entra
        ? {
            tenantId: reference('EXAMPLE_ENTRA_TENANT', optional),
            clientId: reference('EXAMPLE_ENTRA_CLIENT', optional),
            clientSecret: reference('EXAMPLE_ENTRA_SECRET', optional),
          }
        : {}),
      ...(options.oidc
        ? {
            oidc: {
              issuer: reference('EXAMPLE_OIDC_ISSUER', optional),
              clientId: reference('EXAMPLE_OIDC_CLIENT', optional),
              clientSecret: reference('EXAMPLE_OIDC_SECRET', optional),
              ...(typeof options.oidc === 'object' ? options.oidc : {}),
            },
          }
        : {}),
    },
  });
  if (!spec.identity) throw new Error('fixture has no identity');
  return spec.identity;
}

describe('which sign-in credentials a destination resolves', () => {
  test('an Entra-only declaration resolves as it always did', () => {
    set(ENTRA_ENV);
    expect(resolveSignIn(identity({ entra: true }))).toEqual({
      tenantId: ENTRA_ENV.EXAMPLE_ENTRA_TENANT,
      clientId: ENTRA_ENV.EXAMPLE_ENTRA_CLIENT,
      clientSecret: ENTRA_ENV.EXAMPLE_ENTRA_SECRET,
    });
  });

  test('an Entra-only declaration still fails on a missing required variable', () => {
    set({});
    expect(() => resolveSignIn(identity({ entra: true }))).toThrow(
      'Required deployment environment variable EXAMPLE_ENTRA_TENANT is missing.',
    );
  });

  test('an Entra-only declaration with optional references still resolves to nothing', () => {
    set({});
    expect(resolveSignIn(identity({ entra: true, optional: true }))).toEqual({
      tenantId: '',
      clientId: '',
      clientSecret: '',
    });
  });

  test('an OpenID Connect declaration resolves its block and carries the public fields', () => {
    set(OIDC_ENV);
    expect(
      resolveSignIn(
        identity({
          oidc: {
            displayName: 'Example sign-in',
            scopes: ['openid', 'email'],
            pkce: true,
            claimMappings: { email: 'upn' },
            trustEmail: true,
          },
        }),
      ),
    ).toEqual({
      oidc: {
        displayName: 'Example sign-in',
        scopes: ['openid', 'email'],
        pkce: true,
        claimMappings: { email: 'upn' },
        trustEmail: true,
        issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER,
        clientId: OIDC_ENV.EXAMPLE_OIDC_CLIENT,
        clientSecret: OIDC_ENV.EXAMPLE_OIDC_SECRET,
      },
      managedOidc: { issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER },
    });
  });

  test('an OpenID Connect declaration leaves unset public fields out', () => {
    set(OIDC_ENV);
    expect(
      Object.keys(resolveSignIn(identity({ oidc: true })).oidc ?? {}).sort(),
    ).toEqual(['clientId', 'clientSecret', 'issuer']);
  });

  test('a literal issuer needs no environment variable', () => {
    set({
      EXAMPLE_OIDC_CLIENT: OIDC_ENV.EXAMPLE_OIDC_CLIENT,
      EXAMPLE_OIDC_SECRET: OIDC_ENV.EXAMPLE_OIDC_SECRET,
    });
    expect(
      resolveSignIn(identity({ oidc: { issuer: 'https://id.example.org' } }))
        .oidc?.issuer,
    ).toBe('https://id.example.org');
  });

  test('a literal issuer does not make a block that resolves to nothing partial', () => {
    set(ENTRA_ENV);
    expect(
      resolveSignIn(
        identity({
          entra: true,
          optional: true,
          oidc: { issuer: 'https://id.example.org' },
        }),
      ),
    ).toEqual({
      tenantId: ENTRA_ENV.EXAMPLE_ENTRA_TENANT,
      clientId: ENTRA_ENV.EXAMPLE_ENTRA_CLIENT,
      clientSecret: ENTRA_ENV.EXAMPLE_ENTRA_SECRET,
      managedOidc: { issuer: 'https://id.example.org' },
    });
    set({ EXAMPLE_OIDC_CLIENT: OIDC_ENV.EXAMPLE_OIDC_CLIENT });
    expect(() =>
      resolveSignIn(
        identity({
          entra: true,
          optional: true,
          oidc: { issuer: 'https://id.example.org' },
        }),
      ),
    ).toThrow('resolve only in part; set or unset EXAMPLE_OIDC_SECRET');
  });

  describe('both providers declared', () => {
    const both = () => identity({ entra: true, oidc: true, optional: true });

    test('the destination that holds the OpenID Connect set uses it', () => {
      set(OIDC_ENV);
      expect(resolveSignIn(both())).toEqual({
        oidc: {
          issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER,
          clientId: OIDC_ENV.EXAMPLE_OIDC_CLIENT,
          clientSecret: OIDC_ENV.EXAMPLE_OIDC_SECRET,
        },
        managedOidc: { issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER },
      });
    });

    test('the destination that holds the Entra set uses it, and has no issuer to recognise', () => {
      set(ENTRA_ENV);
      expect(resolveSignIn(both())).toEqual({
        tenantId: ENTRA_ENV.EXAMPLE_ENTRA_TENANT,
        clientId: ENTRA_ENV.EXAMPLE_ENTRA_CLIENT,
        clientSecret: ENTRA_ENV.EXAMPLE_ENTRA_SECRET,
        managedOidc: {},
      });
    });

    test('an issuer that resolves with the Entra set is still the one to recognise', () => {
      set({ ...ENTRA_ENV, EXAMPLE_OIDC_ISSUER: 'https://id.example.org' });
      expect(resolveSignIn(both()).managedOidc).toEqual({
        issuer: 'https://id.example.org',
      });
    });

    test('a destination that holds both sets is refused', () => {
      set({ ...ENTRA_ENV, ...OIDC_ENV });
      expect(() => resolveSignIn(both())).toThrow(
        'Both the Entra and the OpenID Connect environment references resolve',
      );
    });

    test('a destination that holds neither set is refused', () => {
      set({});
      expect(() => resolveSignIn(both())).toThrow(
        'Sign-in is enabled but the Entra or OpenID Connect environment references do not resolve',
      );
    });

    test('a block that resolves in part is refused and names what is missing', () => {
      set({
        ...OIDC_ENV,
        EXAMPLE_ENTRA_TENANT: ENTRA_ENV.EXAMPLE_ENTRA_TENANT,
      });
      expect(() => resolveSignIn(both())).toThrow(
        'The Entra environment references resolve only in part; set or unset EXAMPLE_ENTRA_CLIENT, EXAMPLE_ENTRA_SECRET together with the rest of the block.',
      );
      set({ EXAMPLE_OIDC_CLIENT: OIDC_ENV.EXAMPLE_OIDC_CLIENT });
      expect(() => resolveSignIn(both())).toThrow(
        'The OpenID Connect environment references resolve only in part; set or unset EXAMPLE_OIDC_SECRET',
      );
      set({
        EXAMPLE_OIDC_CLIENT: OIDC_ENV.EXAMPLE_OIDC_CLIENT,
        EXAMPLE_OIDC_SECRET: OIDC_ENV.EXAMPLE_OIDC_SECRET,
      });
      expect(() => resolveSignIn(both())).toThrow(
        'The OpenID Connect environment references resolve only in part; set or unset EXAMPLE_OIDC_ISSUER',
      );
    });

    test('an issuer alone does not make a destination the provider’s', () => {
      set({ EXAMPLE_OIDC_ISSUER: OIDC_ENV.EXAMPLE_OIDC_ISSUER });
      expect(() => resolveSignIn(both())).toThrow(
        'environment references do not resolve in this destination',
      );
      set({ ...ENTRA_ENV, EXAMPLE_OIDC_ISSUER: OIDC_ENV.EXAMPLE_OIDC_ISSUER });
      expect(resolveSignIn(both()).tenantId).toBe(
        ENTRA_ENV.EXAMPLE_ENTRA_TENANT,
      );
    });

    test('a refusal never carries a credential', () => {
      set({ ...ENTRA_ENV, ...OIDC_ENV });
      try {
        resolveSignIn(both());
      } catch (error) {
        const message = String(error);
        for (const value of [
          ...Object.values(ENTRA_ENV),
          ...Object.values(OIDC_ENV),
        ])
          expect(message).not.toContain(value);
      }
    });
  });

  test('an issuer from the environment is judged before anything changes', () => {
    for (const issuer of [
      'https://id.example.org/',
      'http://id.example.org',
      'id.example.org',
    ]) {
      set({ ...OIDC_ENV, EXAMPLE_OIDC_ISSUER: issuer });
      expect(() => resolveSignIn(identity({ oidc: true }))).toThrow(
        'EXAMPLE_OIDC_ISSUER is not a canonical HTTPS issuer URL',
      );
    }
  });

  test('the resolved block is accepted by the private provisioning input', () => {
    set(OIDC_ENV);
    const input = parseInstanceInput({
      origin: 'https://native.example.org',
      email: 'operator@example.org',
      password: 'synthetic-password-private',
      slug: 'example-team',
      name: 'Example team',
      ssoEnabled: true,
      ...resolveSignIn(
        identity({
          oidc: { claimMappings: { email: 'upn' }, trustEmail: true },
        }),
      ),
    });
    expect(input.oidc).toMatchObject({
      issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER,
      trustEmail: true,
    });
    expect(input.tenantId).toBeUndefined();
  });

  test('an OpenID Connect declaration alone with optional references that resolve to nothing is refused', () => {
    set({});
    expect(() =>
      resolveSignIn(identity({ oidc: true, optional: true })),
    ).toThrow(
      'Sign-in is enabled but the OpenID Connect environment references do not resolve',
    );
  });

  test('an OpenID Connect declaration alone fails on a missing required variable', () => {
    set({});
    expect(() => resolveSignIn(identity({ oidc: true }))).toThrow(
      'Required deployment environment variable EXAMPLE_OIDC_CLIENT is missing.',
    );
  });
});

describe('what a destination that signs nobody in keeps of the declaration', () => {
  test('nothing for an identity that declares no OpenID Connect block', () => {
    set(ENTRA_ENV);
    expect(resolveManagedOidc(identity({ entra: true }))).toEqual({});
  });

  test('the issuer, from a literal or from an optional or required reference', () => {
    set(OIDC_ENV);
    expect(resolveManagedOidc(identity({ oidc: true }))).toEqual({
      managedOidc: { issuer: OIDC_ENV.EXAMPLE_OIDC_ISSUER },
    });
    expect(
      resolveManagedOidc(
        identity({ oidc: { issuer: 'https://login.example.org' } }),
      ),
    ).toEqual({ managedOidc: { issuer: 'https://login.example.org' } });
  });

  test('no issuer when the destination does not provide one, and never a failure', () => {
    set({});
    expect(resolveManagedOidc(identity({ oidc: true }))).toEqual({
      managedOidc: {},
    });
    expect(
      resolveManagedOidc(identity({ oidc: true, optional: true })),
    ).toEqual({ managedOidc: {} });
  });

  test('no issuer when the destination provides one that is not canonical', () => {
    set({ EXAMPLE_OIDC_ISSUER: 'https://id.example.org/' });
    expect(resolveManagedOidc(identity({ oidc: true }))).toEqual({
      managedOidc: {},
    });
  });
});
