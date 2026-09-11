import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { deploymentSpecSchema } from './model';
import { modelSettingsSchema } from './model-settings';
import { modelSettingsFixture } from './model-settings-fixture';

describe('external model settings declaration', () => {
  test('accepts data-only catalogs and multiple models under one declared provider', () => {
    const settings = modelSettingsFixture();
    settings.providers[0]!.models.push({
      ...settings.providers[0]!.models[0]!,
      id: 'Another-chat-model',
    });
    expect(modelSettingsSchema.parse(settings)).toEqual(settings);
    expect(JSON.stringify(settings)).not.toMatch(
      /omlx|zerotier|readiness|nodes|runtime|weights/i,
    );
  });

  test.each([
    'unknown-server',
    'unknown-topology',
    'duplicate-provider',
    'foreign-model',
    'duplicate-model',
    'wrong-vision',
    'wrong-embedding',
    'wrong-dimensions',
    'wrong-endpoint',
    'endpoint-credentials',
    'catalog-fallback',
    'auth-secret',
    'optional-env-shape',
    'wrong-prefix',
    'control-env',
    'control-name',
    'control-model',
    'control-url',
    'whitespace-url',
    'per-credential',
  ])('refuses %s at the public declaration boundary', (kind) => {
    const settings = modelSettingsFixture();
    const first = settings.providers[0]!;
    const input: Record<string, unknown> = settings;
    if (kind === 'unknown-server') input.server = { models: [] };
    if (kind === 'unknown-topology') input.nodes = [];
    if (kind === 'duplicate-provider')
      settings.providers.push(structuredClone(first));
    if (kind === 'foreign-model') first.models[0]!.provider = 'foreign';
    if (kind === 'duplicate-model')
      first.models.push(structuredClone(first.models[0]!));
    if (kind === 'wrong-vision') settings.vision!.modelId = first.models[0]!.id;
    if (kind === 'wrong-embedding')
      settings.embedding!.providerSlug = first.definition.name;
    if (kind === 'wrong-dimensions') settings.embedding!.dimensions = 0;
    if (kind === 'wrong-endpoint')
      settings.embedding!.baseUrl = 'https://other.example.invalid/v1';
    if (kind === 'endpoint-credentials')
      first.definition.baseUrl = 'https://secret@models.example.invalid/v1';
    if (kind === 'catalog-fallback')
      first.definition.catalog = { source: 'static' };
    if (kind === 'auth-secret')
      (first.credential as unknown as Record<string, unknown>).secret =
        'never-accepted';
    if (kind === 'optional-env-shape')
      (first.credential as unknown as Record<string, unknown>).envName = {
        env: 'KEY',
        optional: true,
      };
    if (kind === 'wrong-prefix') first.credential.envName = 'SECRET';
    if (kind === 'control-env') first.credential.envName += '\n';
    if (kind === 'control-name') first.credential.name += '\n';
    if (kind === 'control-model') first.models[0]!.id += '\n';
    if (kind === 'control-url') first.definition.baseUrl += '\n';
    if (kind === 'whitespace-url')
      first.definition.baseUrl = ` ${first.definition.baseUrl}`;
    if (kind === 'per-credential')
      first.definition.endpointMode = 'per-credential';
    expect(modelSettingsSchema.safeParse(input).success).toBe(false);
  });

  test('requires a tenant and an explicit non-optional deployment environment reference', () => {
    const spec = {
      schemaVersion: 1,
      name: 'example',
      stateDirectory: resolve(tmpdir(), 'example'),
      composeProject: 'tale',
      runtime: { revision: 'a'.repeat(40) },
      origin: 'https://native.example.invalid',
      tlsMode: 'external',
      modelSettings: modelSettingsFixture(),
      identity: {
        email: 'operator@example.invalid',
        slug: 'example',
        name: 'Example',
        ssoEnabled: false,
      },
      environment: {
        TALE_PROVIDER_KEY_EXAMPLE: {
          env: 'EXTERNAL_PROVIDER_SECRET',
          optional: false,
        },
      },
    };
    expect(deploymentSpecSchema.safeParse(spec).success).toBe(true);
    expect(
      deploymentSpecSchema.safeParse({ ...spec, identity: undefined }).success,
    ).toBe(false);
    expect(
      deploymentSpecSchema.safeParse({ ...spec, environment: {} }).success,
    ).toBe(false);
    expect(
      deploymentSpecSchema.safeParse({
        ...spec,
        environment: {
          TALE_PROVIDER_KEY_EXAMPLE: {
            env: 'EXTERNAL_PROVIDER_SECRET',
            optional: true,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      deploymentSpecSchema.safeParse({ ...spec, inference: {} }).success,
    ).toBe(false);
  });
});

for (const locale of ['en', 'de', 'fr']) {
  test.each(['\n', '\r\n'])(
    `the ${locale} operator example parses with %j newlines`,
    async (newline) => {
      const page = await readFile(
        new URL(
          `../../../../../docs/${locale}/self-hosted/install/cli-install.md`,
          import.meta.url,
        ),
        'utf8',
      );
      const checkedPage = page.replace(/\r?\n/g, newline);
      const candidates = [
        ...checkedPage.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g),
      ]
        .map((match) => JSON.parse(match[1]!) as Record<string, unknown>)
        .filter((value) => value.modelSettings);
      expect(candidates).toHaveLength(1);
      expect(
        deploymentSpecSchema.safeParse({
          schemaVersion: 1,
          name: 'example',
          stateDirectory: resolve(tmpdir(), 'example'),
          composeProject: 'tale',
          runtime: { revision: 'a'.repeat(40) },
          origin: 'https://native.example.invalid',
          tlsMode: 'external',
          identity: {
            email: 'operator@example.invalid',
            slug: 'example',
            name: 'Example',
            ssoEnabled: false,
          },
          ...candidates[0],
        }).success,
      ).toBe(true);
    },
  );
}
