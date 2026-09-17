import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { POLICY_SCHEMAS } from '@tale/shared/schemas/governance';

import { deploymentSpecSchema } from '../deployment/model';
import { platformConfigurationFixture } from './platform-fixture';
import {
  parsePlatformConfiguration,
  platformConfigurationSchema,
  resourceConverged,
  resourceId,
} from './platform-model';

describe('native configuration declaration', () => {
  test('uses the same ordinary policy defaults as the platform without requiring providers', () => {
    const configuration = parsePlatformConfiguration({
      schemaVersion: 1,
      resources: [
        { kind: 'governance', key: 'password_policy', config: {} },
        { kind: 'branding', config: { accentColor: '#336699' } },
      ],
    });
    expect(configuration.resources[0]!.config).toEqual(
      POLICY_SCHEMAS.password_policy.parse({}),
    );
    expect(configuration.resources.map(resourceId)).toEqual([
      'governance/password_policy',
      'branding',
    ]);
  });

  test.each([
    { schemaVersion: 2, resources: [] },
    {
      schemaVersion: 1,
      resources: [{ kind: 'file', path: '/etc/passwd', config: {} }],
    },
    {
      schemaVersion: 1,
      resources: [{ kind: 'governance', key: 'retention_policy', config: {} }],
    },
    {
      schemaVersion: 1,
      resources: [{ kind: 'governance', key: 'dsar_governance', config: {} }],
    },
    {
      schemaVersion: 1,
      resources: [{ kind: 'governance', key: '../foreign', config: {} }],
    },
    {
      schemaVersion: 1,
      resources: [
        { kind: 'governance', key: 'password_policy', config: { typo: true } },
      ],
    },
    {
      schemaVersion: 1,
      resources: [{ kind: 'branding', config: { accentColour: '#336699' } }],
    },
    {
      schemaVersion: 1,
      resources: [
        { kind: 'deployment', config: { version: 1, dataStores: {} } },
      ],
    },
  ])(
    'rejects unsupported native fields and special workflows before I/O: %j',
    (input) => {
      expect(platformConfigurationSchema.safeParse(input).success).toBe(false);
      expect(() => parsePlatformConfiguration(input)).toThrow(
        'unsupported resources',
      );
    },
  );

  test('rejects duplicate resources, foreign catalog models and inconsistent model policies', () => {
    for (const change of [
      'duplicate',
      'foreign-model',
      'vision-model',
      'embedding-endpoint',
    ]) {
      const config = platformConfigurationFixture();
      if (change === 'duplicate') config.resources.push(config.resources[0]!);
      if (change === 'foreign-model') {
        const provider = config.resources.find(
          (entry) => entry.kind === 'provider',
        )!;
        provider.expectedModels![0]!.provider = 'another-provider';
      }
      if (change === 'vision-model') {
        const vision = config.resources.find(
          (entry) =>
            entry.kind === 'governance' && entry.key === 'vision_model',
        )!;
        vision.config = { providerSlug: 'private-vision', modelId: 'unlisted' };
      }
      if (change === 'embedding-endpoint') {
        const embedding = config.resources.find(
          (entry) => entry.kind === 'knowledge-embedding',
        )!;
        embedding.config.baseUrl = 'https://other.example.invalid/v1';
      }
      expect(
        platformConfigurationSchema.safeParse(config).success,
        change,
      ).toBe(false);
    }
  });

  test('accepts automatic transcription and validates pinned provider capabilities', () => {
    const declaration = (
      apiFormat = 'openai',
      tags = ['transcription'],
      modelId = 'example-asr',
    ) => ({
      schemaVersion: 1,
      resources: [
        {
          kind: 'provider',
          config: {
            name: 'example-audio',
            displayName: 'Example audio',
            apiFormat,
            baseUrl: 'https://audio.example.invalid/v1',
            catalog: { source: 'models-endpoint' },
            auth: [{ method: 'api-key' }],
          },
          expectedModels: [
            {
              id: 'example-asr',
              provider: 'example-audio',
              tags,
              supportsTools: false,
              supportsVision: false,
              contextWindow: 448,
            },
          ],
        },
        {
          kind: 'governance',
          key: 'transcription_model',
          config: { providerSlug: 'example-audio', modelId },
        },
      ],
    });
    expect(
      platformConfigurationSchema.safeParse({
        schemaVersion: 1,
        resources: [
          { kind: 'governance', key: 'transcription_model', config: {} },
        ],
      }).success,
    ).toBe(true);
    expect(platformConfigurationSchema.safeParse(declaration()).success).toBe(
      true,
    );
    expect(
      platformConfigurationSchema.safeParse(declaration('anthropic')).success,
    ).toBe(false);
    expect(
      platformConfigurationSchema.safeParse(declaration('openai', ['chat']))
        .success,
    ).toBe(false);
    expect(
      platformConfigurationSchema.safeParse(
        declaration('openai', ['transcription'], 'missing'),
      ).success,
    ).toBe(false);
  });

  test('rejects raw credential secrets and unrelated environment variables', () => {
    for (const changes of [
      { secret: 'must-never-appear' },
      { envName: 'BETTER_AUTH_SECRET' },
      { authMethod: 'api-key' },
      { status: 'disabled', isDefault: true },
    ]) {
      const config = platformConfigurationFixture();
      const credential = config.resources.find(
        (entry) => entry.kind === 'provider-credential',
      )!;
      Object.assign(credential.config, changes);
      expect(platformConfigurationSchema.safeParse(config).success).toBe(false);
    }
  });

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

describe('the embedding floor in a declaration', () => {
  const embedding = () =>
    platformConfigurationFixture().resources.find(
      (entry) => entry.kind === 'knowledge-embedding',
    )!;
  const declare = (config: object) =>
    platformConfigurationSchema.safeParse({
      schemaVersion: 1,
      resources: [{ kind: 'knowledge-embedding', config }],
    });

  test('accepts a number, null (clear) and absence (keep); refuses anything else', () => {
    expect(
      declare({ ...embedding().config, minSimilarity: 0.55 }).success,
    ).toBe(true);
    expect(
      declare({ ...embedding().config, minSimilarity: null }).success,
    ).toBe(true);
    expect(declare(embedding().config).success).toBe(true);
    expect(
      declare({ ...embedding().config, minSimilarity: '0.5' }).success,
    ).toBe(false);
    expect(declare({ ...embedding().config, minSimilarity: 1.5 }).success).toBe(
      false,
    );
  });

  test('accepts the serving limits the same three ways, within the platform’s bounds', () => {
    for (const fields of [
      { maxConcurrentRequests: 2, minTokensPerSecond: 750 },
      { maxConcurrentRequests: null, minTokensPerSecond: null },
      { minTokensPerSecond: 1349.5 },
      {},
    ])
      expect(
        declare({ ...embedding().config, ...fields }).success,
        JSON.stringify(fields),
      ).toBe(true);
    for (const fields of [
      { maxConcurrentRequests: 0 },
      { maxConcurrentRequests: 65 },
      { maxConcurrentRequests: 1.5 },
      { minTokensPerSecond: 0 },
      { minTokensPerSecond: '750' },
      { maxConcurrentRequest: 2 },
    ])
      expect(
        declare({ ...embedding().config, ...fields }).success,
        JSON.stringify(fields),
      ).toBe(false);
  });

  test('converges per kept setting when a declaration states several', () => {
    const resource = (fields: object) =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          {
            kind: 'knowledge-embedding',
            config: { ...embedding().config, ...fields },
          },
        ],
      }).resources[0]!;
    const stored = (fields: object) => ({ ...embedding().config, ...fields });
    const limits = { maxConcurrentRequests: 2, minTokensPerSecond: 750 };

    // Omitted settings accept whatever is stored; stated ones must match.
    expect(
      resourceConverged(
        resource({ maxConcurrentRequests: 2 }),
        stored({ ...limits, minSimilarity: 0.5 }),
      ),
    ).toBe(true);
    expect(
      resourceConverged(
        resource(limits),
        stored({ ...limits, minSimilarity: 0.5 }),
      ),
    ).toBe(true);
    expect(
      resourceConverged(
        resource(limits),
        stored({ maxConcurrentRequests: 2, minTokensPerSecond: 500 }),
      ),
    ).toBe(false);
    expect(
      resourceConverged(resource(limits), stored({ maxConcurrentRequests: 2 })),
    ).toBe(false);
    // Null converges only once that setting is gone, whatever else is kept.
    expect(
      resourceConverged(
        resource({ minTokensPerSecond: null, minSimilarity: null }),
        stored({ maxConcurrentRequests: 2 }),
      ),
    ).toBe(true);
    expect(
      resourceConverged(resource({ minTokensPerSecond: null }), stored(limits)),
    ).toBe(false);
    expect(
      resourceConverged(
        resource({ ...limits, minSimilarity: null }),
        stored(limits),
      ),
    ).toBe(true);
  });

  test('converges on the platform’s own terms — omitted keeps, null clears, a number matches exactly', () => {
    const resource = (minSimilarity?: number | null) =>
      parsePlatformConfiguration({
        schemaVersion: 1,
        resources: [
          {
            kind: 'knowledge-embedding',
            config: {
              ...embedding().config,
              ...(minSimilarity === undefined ? {} : { minSimilarity }),
            },
          },
        ],
      }).resources[0]!;
    const stored = (minSimilarity?: number) => ({
      ...embedding().config,
      ...(minSimilarity === undefined ? {} : { minSimilarity }),
    });
    // Omitted: whatever is stored is fine.
    expect(resourceConverged(resource(), stored())).toBe(true);
    expect(resourceConverged(resource(), stored(0.55))).toBe(true);
    // Null: converged only once nothing is stored.
    expect(resourceConverged(resource(null), stored())).toBe(true);
    expect(resourceConverged(resource(null), stored(0.55))).toBe(false);
    // A number: exact.
    expect(resourceConverged(resource(0.6), stored(0.6))).toBe(true);
    expect(resourceConverged(resource(0.6), stored(0.55))).toBe(false);
    expect(resourceConverged(resource(0.6), stored())).toBe(false);
    // Nothing stored at all, and a different model: never converged.
    expect(resourceConverged(resource(), null)).toBe(false);
    expect(
      resourceConverged(resource(), { ...stored(), model: 'Other-model' }),
    ).toBe(false);
  });
});
