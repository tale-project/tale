import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deploymentSpecSchema, resolveDeploymentSpec } from './model';

const revision = 'b'.repeat(40);
const entra = {
  tenantId: { env: 'EXAMPLE_ENTRA_TENANT' },
  clientId: { env: 'EXAMPLE_ENTRA_CLIENT' },
  clientSecret: { env: 'EXAMPLE_ENTRA_SECRET' },
};
const optionalEntra = {
  tenantId: { env: 'EXAMPLE_ENTRA_TENANT', optional: true },
  clientId: { env: 'EXAMPLE_ENTRA_CLIENT', optional: true },
  clientSecret: { env: 'EXAMPLE_ENTRA_SECRET', optional: true },
};
const oidc = {
  issuer: 'https://id.example.org',
  clientId: { env: 'EXAMPLE_OIDC_CLIENT' },
  clientSecret: { env: 'EXAMPLE_OIDC_SECRET' },
};
const optionalOidc = {
  issuer: { env: 'EXAMPLE_OIDC_ISSUER', optional: true },
  clientId: { env: 'EXAMPLE_OIDC_CLIENT', optional: true },
  clientSecret: { env: 'EXAMPLE_OIDC_SECRET', optional: true },
};
const spec = (identity: Record<string, unknown>) => ({
  schemaVersion: 1,
  name: 'north-labs',
  stateDirectory: join(tmpdir(), 'north-labs'),
  composeProject: 'tale',
  runtime: { revision, platform: 'linux/amd64' },
  origin: 'https://desk.north-labs.example',
  tlsMode: 'external',
  identity: {
    email: { env: 'LOCAL_EMAIL' },
    slug: 'north-labs',
    name: 'North Labs',
    ssoEnabled: true,
    ...identity,
  },
});
const issues = (input: unknown) => {
  const result = deploymentSpecSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('the declaration of a generic OpenID Connect sign-in', () => {
  test('an Entra-only declaration is judged exactly as before', () => {
    expect(issues(spec(entra))).toEqual([]);
    expect(issues(spec({ ssoEnabled: false }))).toEqual([]);
    expect(issues(spec({}))).toEqual(
      ['tenantId', 'clientId', 'clientSecret'].map((field) => [
        `identity.${field}`,
        'Entra environment reference is required',
      ]),
    );
    expect(issues(spec({ tenantId: entra.tenantId }))).toEqual(
      ['clientId', 'clientSecret'].map((field) => [
        `identity.${field}`,
        'Entra environment reference is required',
      ]),
    );
  });

  test('a declaration of OpenID Connect alone needs no Entra fields', () => {
    expect(issues(spec({ oidc }))).toEqual([]);
    expect(deploymentSpecSchema.parse(spec({ oidc })).identity?.oidc).toEqual(
      oidc,
    );
  });

  test('the credentials of the block stay references and never become values', () => {
    const resolved = resolveDeploymentSpec(spec({ oidc }), {
      LOCAL_EMAIL: 'operator@example.org',
      EXAMPLE_OIDC_CLIENT: 'must-not-appear',
      EXAMPLE_OIDC_SECRET: 'must-not-appear',
    });
    expect(JSON.stringify(resolved)).not.toContain('must-not-appear');
    expect(resolved.identity?.oidc?.clientSecret).toEqual(oidc.clientSecret);
  });

  test('both providers may be declared when every reference is optional', () => {
    expect(
      issues(spec({ ...optionalEntra, oidc: { ...oidc, ...optionalOidc } })),
    ).toEqual([]);
    // A literal issuer is no reference, so it needs no optional flag.
    expect(
      issues(
        spec({
          ...optionalEntra,
          oidc: { ...optionalOidc, issuer: 'https://id.example.org' },
        }),
      ),
    ).toEqual([]);
  });

  test('both providers with a required reference are refused at the reference', () => {
    expect(issues(spec({ ...entra, oidc }))).toEqual(
      [
        'tenantId',
        'clientId',
        'clientSecret',
        'oidc.clientId',
        'oidc.clientSecret',
      ].map((path) => [
        `identity.${path}`,
        'With both Entra and OpenID Connect declared, each environment reference must be optional',
      ]),
    );
    expect(
      issues(
        spec({
          ...optionalEntra,
          oidc: { ...optionalOidc, issuer: { env: 'EXAMPLE_OIDC_ISSUER' } },
        }),
      ),
    ).toEqual([
      [
        'identity.oidc.issuer',
        'With both Entra and OpenID Connect declared, each environment reference must be optional',
      ],
    ]);
  });

  test('a half-declared Entra block beside OpenID Connect is refused', () => {
    expect(issues(spec({ tenantId: optionalEntra.tenantId, oidc }))).toEqual(
      ['clientId', 'clientSecret'].map((field) => [
        `identity.${field}`,
        'Entra environment reference is required',
      ]),
    );
  });

  test('a block left in a declaration that signs nobody in is not judged', () => {
    expect(issues(spec({ ssoEnabled: false, oidc }))).toEqual([]);
  });

  test('vouching for the email needs the email claim to be mapped', () => {
    const message = 'Vouching for the email needs the email claim to be mapped';
    expect(issues(spec({ oidc: { ...oidc, trustEmail: true } }))).toEqual([
      ['identity.oidc.trustEmail', message],
    ]);
    expect(
      issues(
        spec({
          oidc: { ...oidc, trustEmail: true, claimMappings: { name: 'name' } },
        }),
      ),
    ).toEqual([['identity.oidc.trustEmail', message]]);
    expect(
      issues(
        spec({
          oidc: { ...oidc, trustEmail: true, claimMappings: { email: 'upn' } },
        }),
      ),
    ).toEqual([]);
    expect(issues(spec({ oidc: { ...oidc, trustEmail: false } }))).toEqual([]);
  });

  test.each([
    ['an unknown key', { createUsers: true }],
    ['an empty claim mapping block', { claimMappings: {} }],
    ['an empty scope list', { scopes: [] }],
    ['a scope with a space', { scopes: ['open id'] }],
    ['a padded display name', { displayName: ' Sign in ' }],
    ['a plain HTTP issuer', { issuer: 'http://id.example.org' }],
    ['an issuer with a trailing slash', { issuer: 'https://id.example.org/' }],
    [
      'an issuer path with a trailing slash',
      { issuer: 'https://login.example.org/realms/north/' },
    ],
    ['an issuer ending in two slashes', { issuer: 'https://id.example.org//' }],
    ['an issuer with credentials', { issuer: 'https://a:b@id.example.org' }],
    ['an issuer with a fragment', { issuer: 'https://id.example.org#x' }],
    ['an upper-case issuer host', { issuer: 'https://ID.example.org' }],
    ['a credential that is a literal', { clientSecret: 'a-secret' }],
  ])('refuses %s', (_name, change) => {
    expect(
      issues(spec({ oidc: { ...oidc, ...change } })).length,
    ).toBeGreaterThan(0);
  });

  test('accepts an issuer with a path and a loopback HTTP issuer', () => {
    for (const issuer of [
      'https://login.example.org/realms/north',
      'http://localhost:18090',
      'http://127.0.0.1:18090',
    ])
      expect(issues(spec({ oidc: { ...oidc, issuer } }))).toEqual([]);
  });
});
