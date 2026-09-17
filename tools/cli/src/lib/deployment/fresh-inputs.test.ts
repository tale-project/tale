import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deploymentSpecSchema } from './model';

const config = {
  repository: 'https://github.com/example/north-labs',
  revision: 'a'.repeat(40),
  client: 'north-labs',
  descriptor: 'tale/client.json',
  automation: 'document-desk',
  project: { key: 'NORTH', name: 'Document desk' },
  skillOwner: 'operator',
};
const spec = {
  schemaVersion: 1,
  name: 'north-labs',
  stateDirectory: join(tmpdir(), 'north-labs'),
  composeProject: 'tale',
  runtime: { revision: 'b'.repeat(40) },
  origin: 'https://native.example.org',
  tlsMode: 'external',
  identity: {
    bootstrap: 'fresh',
    email: { env: 'OPERATOR_EMAIL' },
    slug: 'north-labs',
    name: 'North Labs',
    ssoEnabled: false,
    nativeClients: [
      {
        key: 'portal',
        name: 'Client portal',
        managed: true,
        redirectUris: ['https://portal.example.org/oauth/callback'],
      },
    ],
  },
  configs: [config],
};

test('fresh declarations carry symbolic native targets without old database identifiers', () => {
  const actual = deploymentSpecSchema.parse(spec);
  expect(actual.configs[0]?.project).toEqual(config.project);
  expect(actual.configs[0]?.skillOwner).toBe('operator');
  expect(actual.identity?.bootstrap).toBe('fresh');
  expect(actual.identity?.nativeClients[0]?.managed).toBe(true);
});

test('origin migration requires an explicit different HTTPS source and retained fresh identity', () => {
  const identity = {
    ...spec.identity,
    migrateOriginFrom: 'https://old.example.org',
  };
  expect(
    deploymentSpecSchema.parse({ ...spec, identity }).identity
      ?.migrateOriginFrom,
  ).toBe('https://old.example.org');
  for (const changed of [
    { ...identity, bootstrap: undefined },
    ...[
      spec.origin,
      'http://old.example.org',
      'https://old.example.org/path',
      'https://old.example.org/',
    ].map((migrateOriginFrom) =>
      Object.assign({}, identity, { migrateOriginFrom }),
    ),
  ])
    expect(
      deploymentSpecSchema.safeParse({ ...spec, identity: changed }).success,
    ).toBe(false);
});

test('operator address migration requires a different previous address literal and retained fresh identity', () => {
  const identity = {
    ...spec.identity,
    email: 'deploy@example.org',
    migrateEmailFrom: 'Operator@example.org',
  };
  expect(
    deploymentSpecSchema.parse({ ...spec, identity }).identity
      ?.migrateEmailFrom,
  ).toBe('Operator@example.org');
  // An environment-referenced operator address is compared at the destination.
  expect(
    deploymentSpecSchema.safeParse({
      ...spec,
      identity: { ...identity, email: { env: 'OPERATOR_EMAIL' } },
    }).success,
  ).toBe(true);
  for (const changed of [
    { ...identity, bootstrap: undefined },
    { ...identity, migrateEmailFrom: 'DEPLOY@example.org' },
    { ...identity, migrateEmailFrom: { env: 'PREVIOUS_OPERATOR_EMAIL' } },
    { ...identity, migrateEmailFrom: 'not-an-address' },
    { ...identity, migrateEmailFrom: 'operator@example.org\n' },
  ])
    expect(
      deploymentSpecSchema.safeParse({ ...spec, identity: changed }).success,
    ).toBe(false);
});

test('a break-glass administrator declares its own address and only an environment-referenced hash', () => {
  const identity = {
    ...spec.identity,
    email: 'deploy@example.org',
    migrateEmailFrom: 'operator@example.org',
    breakGlass: {
      email: 'break-glass@example.org',
      passwordHash: { env: 'BREAK_GLASS_PASSWORD_HASH' },
    },
  };
  const parsed = deploymentSpecSchema.parse({ ...spec, identity });
  expect(parsed.identity?.breakGlass).toEqual(identity.breakGlass);
  expect(
    deploymentSpecSchema.safeParse({
      ...spec,
      identity: {
        ...identity,
        breakGlass: {
          ...identity.breakGlass,
          email: { env: 'BREAK_GLASS_EMAIL' },
        },
      },
    }).success,
  ).toBe(true);
  for (const breakGlass of [
    { ...identity.breakGlass, email: 'DEPLOY@example.org' },
    { ...identity.breakGlass, email: 'Operator@example.org' },
    { ...identity.breakGlass, email: 'not-an-address' },
    {
      ...identity.breakGlass,
      email: { env: 'BREAK_GLASS_EMAIL', optional: true },
    },
    {
      ...identity.breakGlass,
      passwordHash: { env: 'BREAK_GLASS_PASSWORD_HASH', optional: true },
    },
    {
      ...identity.breakGlass,
      passwordHash: `${'a'.repeat(32)}:${'b'.repeat(128)}`,
    },
    { email: identity.breakGlass.email },
    { ...identity.breakGlass, password: { env: 'BREAK_GLASS_PASSWORD' } },
  ])
    expect(
      deploymentSpecSchema.safeParse({
        ...spec,
        identity: { ...identity, breakGlass },
      }).success,
    ).toBe(false);
});

test('an additional origin may keep the migrated-from origin answering during a move', () => {
  const identity = {
    ...spec.identity,
    migrateOriginFrom: 'https://old.example.org',
  };
  const moved = deploymentSpecSchema.parse({
    ...spec,
    identity,
    additionalOrigins: ['https://old.example.org'],
  });
  expect(moved.additionalOrigins).toEqual(['https://old.example.org']);
  expect(moved.identity?.migrateOriginFrom).toBe('https://old.example.org');
  expect(
    deploymentSpecSchema.safeParse({
      ...spec,
      identity,
      additionalOrigins: [spec.origin],
    }).success,
  ).toBe(false);
});

test('operator email attestation is explicit and restricted to fresh identity declarations', () => {
  const selected = {
    ...spec,
    identity: { ...spec.identity, emailVerification: 'operator-attested' },
  };
  expect(deploymentSpecSchema.safeParse(selected).success).toBe(true);
  for (const identity of [
    { ...selected.identity, bootstrap: undefined },
    { ...selected.identity, emailVerification: true },
    { ...selected.identity, emailVerification: 'operator-attested\n' },
    { ...selected.identity, emailVerification: 'mail-delivered' },
  ])
    expect(deploymentSpecSchema.safeParse({ ...spec, identity }).success).toBe(
      false,
    );
});

test('symbolic targets reject ambiguous identity, native normalization and conflicting keys', () => {
  for (const changed of [
    { ...config, projectId: 'old-project' },
    { ...config, project: undefined },
    ...['A', 'TOOLONG', 'north', 'NORTH\n', 'NO-TH'].map((key) =>
      Object.assign({}, config, {
        project: { ...config.project, key },
      }),
    ),
    { ...config, project: { ...config.project, name: ' Name ' } },
  ])
    expect(
      deploymentSpecSchema.safeParse({ ...spec, configs: [changed] }).success,
    ).toBe(false);
  expect(
    deploymentSpecSchema.safeParse({
      ...spec,
      configs: [
        config,
        {
          ...config,
          automation: 'other-desk',
          project: { key: 'NORTH', name: 'Another project' },
        },
      ],
    }).success,
  ).toBe(false);
  const client = spec.identity.nativeClients[0]!;
  for (const changed of [
    { ...client, clientId: 'old-client' },
    { ...client, managed: undefined },
  ])
    expect(
      deploymentSpecSchema.safeParse({
        ...spec,
        identity: { ...spec.identity, nativeClients: [changed] },
      }).success,
    ).toBe(false);
});
