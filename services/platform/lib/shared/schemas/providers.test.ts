import { describe, expect, it } from 'vitest';

import {
  BROKER_SECRET_ENV_PREFIX,
  BROKER_SECRET_ENV_REGEX,
  brokerCredentialDataSchema,
  harnessConnectorSchema,
  modelCatalogEntrySchema,
  modelCatalogFileSchema,
  providerConnectorSchema,
  providerKeyEnvNameSchema,
  SECRETS_ENV_PREFIX,
  SECRETS_ENV_REGEX,
} from './providers';

// A representative valid document per schema; each rejection case mutates one
// field so a failure names exactly the violated rule.

const VALID_CONNECTOR = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  catalog: { source: 'static' },
  auth: [
    { method: 'api-key' },
    { method: 'env' },
    {
      method: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
} as const;

const VALID_MODEL = {
  id: 'claude-fable-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  reasoning: { knob: 'effort' },
  contextWindow: 200000,
  maxOutputTokens: 128000,
  pricing: { inputCentsPerMillion: 1000, outputCentsPerMillion: 5000 },
} as const;

// The retired example-broker token source translated onto the credential
// shape — the migration's lossless field mapping in miniature.
const VALID_BROKER = {
  endpoint: 'https://broker.example.com/api/tokens',
  httpMethod: 'GET',
  auth: { method: 'bearer', secretEnv: 'TALE_TOKEN_SOURCE_EXAMPLE' },
  responseMapping: {
    tokensPath: '$.tokens',
    tokenField: 'access_token',
    statusField: 'status',
    activeValue: 'active',
    expiresField: 'expires_at',
  },
  targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  selection: 'random',
} as const;

const VALID_HARNESS = {
  slug: 'claude-code',
  displayName: 'Claude Code',
  credentialPolicy: { managed: true, byo: true },
  credentialEnvKeys: ['ANTHROPIC_API_KEY', 'TALE_GATEWAY_TOKEN'],
  modelIdDialect: 'vendor-native',
  promptTransport: 'stdin-ndjson',
  capabilities: { planMode: true, steering: true, mcp: true },
  parser: 'claude-stream-json',
  // A minimal exec coherent with the declared capabilities/transport: the
  // posture slot backs planMode, the held NDJSON stdin backs steering, and
  // the argv MCP slot backs mcp.
  exec: {
    bin: 'claude',
    argv: [
      { args: ['-p'] },
      { posture: { plan: ['--mode', 'plan'], act: ['--mode', 'act'] } },
      {
        mcp: {
          delivery: 'config-json-flag',
          flag: '--mcp-config',
          bridgeEnv: { TALE_INTEGRATIONS_URL: '${bridgeUrl}' },
        },
      },
    ],
    stdin: { mode: 'ndjson-user-message' },
    env: { managed: { ANTHROPIC_AUTH_TOKEN: '${gateway.token}' } },
  },
  pinnedVersion: '2.1.173',
} as const;

describe('SECRETS_ENV prefix gate', () => {
  it('accepts prefixed names', () => {
    expect(SECRETS_ENV_REGEX.test('TALE_PROVIDER_KEY_OPENAI')).toBe(true);
    expect(
      providerKeyEnvNameSchema.safeParse('TALE_PROVIDER_KEY_openrouter_2')
        .success,
    ).toBe(true);
  });

  it('rejects names outside the reserved namespace', () => {
    expect(SECRETS_ENV_REGEX.test('OPENAI_API_KEY')).toBe(false);
    expect(SECRETS_ENV_REGEX.test('SOPS_AGE_KEY')).toBe(false);
    expect(
      providerKeyEnvNameSchema.safeParse('BETTER_AUTH_SECRET').success,
    ).toBe(false);
  });

  it('rejects the bare prefix and illegal suffix characters', () => {
    expect(SECRETS_ENV_REGEX.test(SECRETS_ENV_PREFIX)).toBe(false);
    expect(SECRETS_ENV_REGEX.test('TALE_PROVIDER_KEY_A-B')).toBe(false);
  });

  it('caps the name at the env-sync limit of 40 chars', () => {
    const suffix = 'A'.repeat(40 - SECRETS_ENV_PREFIX.length);
    expect(
      providerKeyEnvNameSchema.safeParse(`${SECRETS_ENV_PREFIX}${suffix}`)
        .success,
    ).toBe(true);
    expect(
      providerKeyEnvNameSchema.safeParse(`${SECRETS_ENV_PREFIX}${suffix}A`)
        .success,
    ).toBe(false);
  });
});

describe('providerConnectorSchema', () => {
  it('accepts a full connector with all three auth methods', () => {
    expect(providerConnectorSchema.safeParse(VALID_CONNECTOR).success).toBe(
      true,
    );
  });

  it('accepts each catalog source', () => {
    for (const source of ['static', 'openrouter-api', 'models-endpoint']) {
      const result = providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        catalog: { source },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a non-slug name', () => {
    expect(
      providerConnectorSchema.safeParse({ ...VALID_CONNECTOR, name: 'OpenAI' })
        .success,
    ).toBe(false);
    expect(
      providerConnectorSchema.safeParse({ ...VALID_CONNECTOR, name: 'open_ai' })
        .success,
    ).toBe(false);
  });

  it('rejects a non-https baseUrl', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        baseUrl: 'http://api.anthropic.com',
      }).success,
    ).toBe(false);
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        baseUrl: 'not a url',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown apiFormat', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        apiFormat: 'gemini',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown catalog source', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        catalog: { source: 'weekly-sync' },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty auth array', () => {
    expect(
      providerConnectorSchema.safeParse({ ...VALID_CONNECTOR, auth: [] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate auth methods', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        auth: [{ method: 'api-key' }, { method: 'api-key' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a subscription-broker method without constraints', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        auth: [{ method: 'subscription-broker' }],
      }).success,
    ).toBe(false);
  });

  it('rejects broker constraints demanding direct execution', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        auth: [
          {
            method: 'subscription-broker',
            constraints: { execution: 'direct', harness: 'claude-code' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields on api-key and env auth entries', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        auth: [{ method: 'api-key', apiKey: 'sk-live-oops' }],
      }).success,
    ).toBe(false);
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        auth: [{ method: 'env', name: 'TALE_PROVIDER_KEY_X' }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    expect(
      providerConnectorSchema.safeParse({
        ...VALID_CONNECTOR,
        models: [],
      }).success,
    ).toBe(false);
  });
});

describe('modelCatalogEntrySchema', () => {
  it('accepts a full entry', () => {
    expect(modelCatalogEntrySchema.safeParse(VALID_MODEL).success).toBe(true);
  });

  it('accepts a minimal entry without reasoning, output cap, or pricing', () => {
    const minimal = {
      id: 'gpt-5.3-chat',
      provider: 'openai',
      tags: ['chat'],
      supportsTools: true,
      supportsVision: true,
      contextWindow: 128000,
    };
    expect(modelCatalogEntrySchema.safeParse(minimal).success).toBe(true);
  });

  it('accepts the budget-tokens reasoning knob', () => {
    expect(
      modelCatalogEntrySchema.safeParse({
        ...VALID_MODEL,
        reasoning: { knob: 'budget-tokens' },
      }).success,
    ).toBe(true);
  });

  it('rejects the retired camel-case knob spelling', () => {
    expect(
      modelCatalogEntrySchema.safeParse({
        ...VALID_MODEL,
        reasoning: { knob: 'budgetTokens' },
      }).success,
    ).toBe(false);
  });

  it('rejects a missing capability boolean', () => {
    const { supportsTools: _supportsTools, ...withoutTools } = VALID_MODEL;
    expect(modelCatalogEntrySchema.safeParse(withoutTools).success).toBe(false);
  });

  it('rejects a non-positive or fractional contextWindow', () => {
    expect(
      modelCatalogEntrySchema.safeParse({ ...VALID_MODEL, contextWindow: 0 })
        .success,
    ).toBe(false);
    expect(
      modelCatalogEntrySchema.safeParse({
        ...VALID_MODEL,
        contextWindow: 200000.5,
      }).success,
    ).toBe(false);
  });

  it('rejects negative or partial pricing', () => {
    expect(
      modelCatalogEntrySchema.safeParse({
        ...VALID_MODEL,
        pricing: { inputCentsPerMillion: -1, outputCentsPerMillion: 5000 },
      }).success,
    ).toBe(false);
    expect(
      modelCatalogEntrySchema.safeParse({
        ...VALID_MODEL,
        pricing: { inputCentsPerMillion: 1000 },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      modelCatalogEntrySchema.safeParse({ ...VALID_MODEL, qualityScore: 0.9 })
        .success,
    ).toBe(false);
  });
});

describe('modelCatalogFileSchema', () => {
  it('accepts a list of entries', () => {
    expect(
      modelCatalogFileSchema.safeParse([
        VALID_MODEL,
        { ...VALID_MODEL, id: 'claude-haiku-4-5' },
      ]).success,
    ).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(modelCatalogFileSchema.safeParse([]).success).toBe(false);
  });

  it('rejects duplicate model ids', () => {
    expect(
      modelCatalogFileSchema.safeParse([VALID_MODEL, VALID_MODEL]).success,
    ).toBe(false);
  });
});

describe('brokerCredentialDataSchema', () => {
  it('accepts the translated example broker and fills the tuning defaults', () => {
    const result = brokerCredentialDataSchema.safeParse(VALID_BROKER);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timeoutMs).toBe(10_000);
      expect(result.data.maxResponseBytes).toBe(262_144);
      expect(result.data.expirySkewMs).toBe(300_000);
      expect(result.data.authSecret).toBeUndefined();
    }
  });

  it('accepts a stored auth secret and explicit tuning values', () => {
    const result = brokerCredentialDataSchema.safeParse({
      ...VALID_BROKER,
      authSecret: 'broker-s3cret',
      timeoutMs: 5_000,
      maxResponseBytes: 4_096,
      expirySkewMs: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authSecret).toBe('broker-s3cret');
      expect(result.data.timeoutMs).toBe(5_000);
    }
  });

  it('accepts every auth method, including a custom header', () => {
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        auth: { method: 'none' },
      }).success,
    ).toBe(true);
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        auth: { method: 'header', headerName: 'X-Broker-Key' },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-https broker endpoint', () => {
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        endpoint: 'http://broker.example.com/api/tokens',
      }).success,
    ).toBe(false);
  });

  it('rejects a secretEnv outside the broker namespace', () => {
    expect(BROKER_SECRET_ENV_REGEX.test('TALE_TOKEN_SOURCE_X')).toBe(true);
    expect(BROKER_SECRET_ENV_REGEX.test(BROKER_SECRET_ENV_PREFIX)).toBe(false);
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        auth: { method: 'bearer', secretEnv: 'SOPS_AGE_KEY' },
      }).success,
    ).toBe(false);
    // The provider-key namespace is deliberately NOT valid here either.
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        auth: { method: 'bearer', secretEnv: 'TALE_PROVIDER_KEY_OPENAI' },
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed targetEnvVar', () => {
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        targetEnvVar: '1BAD',
      }).success,
    ).toBe(false);
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        targetEnvVar: 'BAD-NAME',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown selection strategy and the retired mapping spellings', () => {
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        selection: 'sticky',
      }).success,
    ).toBe(false);
    // The old token-source field names must be translated, never carried.
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        responseMapping: {
          tokensPath: '$.tokens',
          tokenField: 'access_token',
          statusActiveValue: 'active',
        },
      }).success,
    ).toBe(false);
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        responseMapping: {
          tokensPath: '$.tokens',
          tokenField: 'access_token',
          expiryField: 'expires_at',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects out-of-bounds tuning values and unknown keys', () => {
    expect(
      brokerCredentialDataSchema.safeParse({ ...VALID_BROKER, timeoutMs: 100 })
        .success,
    ).toBe(false);
    expect(
      brokerCredentialDataSchema.safeParse({
        ...VALID_BROKER,
        expirySkewMs: 7_200_000,
      }).success,
    ).toBe(false);
    expect(
      brokerCredentialDataSchema.safeParse({ ...VALID_BROKER, slug: 'legacy' })
        .success,
    ).toBe(false);
  });
});

describe('harnessConnectorSchema', () => {
  it('accepts a full harness', () => {
    expect(harnessConnectorSchema.safeParse(VALID_HARNESS).success).toBe(true);
  });

  it('accepts a harness without a pinned version', () => {
    const { pinnedVersion: _pinnedVersion, ...unpinned } = VALID_HARNESS;
    expect(harnessConnectorSchema.safeParse(unpinned).success).toBe(true);
  });

  it('accepts one-sided credential policies', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        credentialPolicy: { managed: false, byo: true },
        // A byo-only harness must carry no managed-only exec sections (the
        // coherence refinement) — drop the managed env for this case.
        exec: { ...VALID_HARNESS.exec, env: {} },
      }).success,
    ).toBe(true);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        credentialPolicy: { managed: true, byo: false },
      }).success,
    ).toBe(true);
  });

  it('rejects a policy that accepts neither credential mode', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        credentialPolicy: { managed: false, byo: false },
      }).success,
    ).toBe(false);
  });

  it('rejects malformed or duplicate credential env keys', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        credentialEnvKeys: ['anthropic_api_key'],
      }).success,
    ).toBe(false);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        credentialEnvKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
      }).success,
    ).toBe(false);
  });

  it('rejects the retired argv-positional transport spelling', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        promptTransport: 'argv-positional',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown model-id dialect', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        modelIdDialect: 'native',
      }).success,
    ).toBe(false);
  });

  it('rejects an incomplete capabilities object', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        capabilities: { planMode: true, steering: true },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        mcpDelivery: 'inline-argv',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing or unknown parser family', () => {
    const { parser: _parser, ...withoutParser } = VALID_HARNESS;
    expect(harnessConnectorSchema.safeParse(withoutParser).success).toBe(false);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        parser: 'brand-new-stream',
      }).success,
    ).toBe(false);
  });

  it('rejects a harness without exec facts', () => {
    const { exec: _exec, ...withoutExec } = VALID_HARNESS;
    expect(harnessConnectorSchema.safeParse(withoutExec).success).toBe(false);
  });

  it('rejects an exec incoherent with the declared capabilities', () => {
    // Dropping the posture slot contradicts planMode; the coherence
    // refinements are exercised in depth over the shipped tree in
    // lib/harnesses/registry.test.ts.
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        exec: {
          ...VALID_HARNESS.exec,
          argv: VALID_HARNESS.exec.argv.filter((s) => !('posture' in s)),
        },
      }).success,
    ).toBe(false);
  });

  it('accepts and gates the subscription delivery shapes', () => {
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        subscription: {
          kind: 'env',
          tokenVar: 'ANTHROPIC_AUTH_TOKEN',
          baseUrlVar: 'ANTHROPIC_BASE_URL',
        },
      }).success,
    ).toBe(true);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        subscription: { kind: 'staged-file', path: '.runtime/home/creds.json' },
      }).success,
    ).toBe(true);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        subscription: { kind: 'env', tokenVar: 'not-an-env-name' },
      }).success,
    ).toBe(false);
    expect(
      harnessConnectorSchema.safeParse({
        ...VALID_HARNESS,
        subscription: { kind: 'staged-file' },
      }).success,
    ).toBe(false);
  });
});
