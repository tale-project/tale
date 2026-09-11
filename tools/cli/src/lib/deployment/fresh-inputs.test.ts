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
