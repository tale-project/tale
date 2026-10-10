import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { platformConfigurationFixture } from '../../../../../packages/shared/src/config/platform-resources.fixture';
import { deploymentSpecSchema } from '../deployment/model';
import { parsePlatformConfiguration } from './platform-model';

// The resource model's own cases (kinds, defaults, cross-resource rules,
// convergence) live beside it in @tale/shared/config/platform-resources.
describe('native configuration declaration', () => {
  test.each([
    {
      schemaVersion: 1,
      resources: [{ kind: 'governance', key: 'retention_policy', config: {} }],
    },
    {
      schemaVersion: 1,
      resources: [{ kind: 'branding', config: { accentColour: '#336699' } }],
    },
  ])(
    'refuses an unsupported declaration as a usage error before I/O: %j',
    (input) => {
      expect(() => parsePlatformConfiguration(input)).toThrow(
        'unsupported resources',
      );
    },
  );

  test('deployment configuration needs a native organization and explicit provider env references', () => {
    const spec = {
      schemaVersion: 1,
      name: 'example',
      stateDirectory: resolve(tmpdir(), 'tale-example'),
      composeProject: 'tale',
      runtime: { revision: 'a'.repeat(40) },
      origin: 'https://native.example.invalid',
      tlsMode: 'external',
      configuration: platformConfigurationFixture(),
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
          TALE_PROVIDER_KEY_EXAMPLE: { env: 'KEY', optional: true },
        },
      }).success,
    ).toBe(false);
    expect(
      deploymentSpecSchema.safeParse({ ...spec, modelSettings: {} }).success,
    ).toBe(false);
    expect(
      deploymentSpecSchema.safeParse({ ...spec, inference: {} }).success,
    ).toBe(false);
  });
});
