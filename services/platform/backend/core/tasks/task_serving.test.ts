// @vitest-environment node

/**
 * The task-agent serving-lane split, off the wire: which lane a turn runs
 * on (gateway vs subscription), that a provider PIN is honored fail-closed
 * (never a silent fallback to another provider), and that every refusal
 * names the problem. Unpinned resolution delegates to `resolveServingTarget`
 * (proven in its own suite — substituted here, only the delegation
 * asserted); pinned resolution is the shared `resolvePinnedAgentServing`,
 * exercised for real over the mocked connector and catalog fixtures.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  harnessDefinitionSchema,
  providerDefinitionSchema,
  type ProviderDefinition,
} from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../lib/ctx';

const {
  resolveServingTarget,
  getProviderCatalog,
  resolveConnectors,
  loadHarnesses,
} = vi.hoisted(() => ({
  resolveServingTarget: vi.fn(),
  getProviderCatalog: vi.fn(),
  resolveConnectors: vi.fn(),
  loadHarnesses: vi.fn(),
}));

vi.mock('../automations/llm_call', () => ({ resolveServingTarget }));
vi.mock('../lib/providers/catalog_fetch', () => ({ getProviderCatalog }));
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: resolveConnectors,
}));
vi.mock('../lib/providers/load_system_config', () => ({ loadHarnesses }));

import { resolveTaskServing } from './task_serving';

const ORG = 'org_serving';

/** Parsed through the schema so the fixture can never drift from the shape
 * the loader would deliver (same convention as resolve_execution.test.ts). */
function harness(
  slug: string,
  policy: { managed: boolean; byo: boolean },
  withSubscriptionDelivery: boolean,
) {
  return harnessDefinitionSchema.parse({
    slug,
    displayName: slug,
    credentialPolicy: policy,
    credentialEnvKeys: ['TALE_GATEWAY_TOKEN'],
    modelIdDialect: 'vendor-native',
    promptTransport: 'stdin-ndjson',
    capabilities: { planMode: false, steering: false, mcp: false },
    parser: 'hermes-jsonl',
    exec: {
      bin: 'test-harness',
      argv: [{ args: ['--workdir', '${workdir}'] }],
      stdin: { mode: 'json-envelope', envelope: [{ prompt: {} }] },
      ...(policy.managed && {
        env: { managed: { TALE_GATEWAY_TOKEN: '${gateway.token}' } },
      }),
    },
    ...(withSubscriptionDelivery && {
      subscription: {
        kind: 'env',
        tokenVar: 'ANTHROPIC_AUTH_TOKEN',
        baseUrlVar: 'ANTHROPIC_BASE_URL',
      },
    }),
  });
}

const ANTHROPIC: ProviderDefinition = providerDefinitionSchema.parse({
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  catalog: { source: 'static' },
  auth: [
    { method: 'api-key' },
    {
      method: 'subscription-broker',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
});

const ZAI: ProviderDefinition = providerDefinitionSchema.parse({
  name: 'z-ai',
  displayName: 'Z.ai',
  apiFormat: 'openai',
  baseUrl: 'https://api.z.ai/v1',
  catalog: { source: 'static' },
  auth: [
    {
      method: 'subscription-key',
      baseUrl: 'https://coding.z.ai/api/anthropic',
      apiFormat: 'anthropic',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
});

const OPENROUTER: ProviderDefinition = providerDefinitionSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'openrouter-api' },
  auth: [{ method: 'api-key' }, { method: 'env' }],
});

/** Default-credential rows by provider slug; the fake ctx serves them. */
let credentials: Record<string, unknown>;

const ctx = {
  runQuery: vi.fn((_ref: unknown, args: { providerSlug: string }) =>
    Promise.resolve(credentials[args.providerSlug] ?? null),
  ),
} as unknown as ActionCtx;

const BROKER = { status: 'active', authMethod: 'subscription-broker' };

beforeEach(() => {
  vi.clearAllMocks();
  credentials = {};
  resolveConnectors.mockResolvedValue([ANTHROPIC, OPENROUTER, ZAI]);
  getProviderCatalog.mockResolvedValue([{ id: 'claude-sonnet-4-6' }]);
  loadHarnesses.mockReturnValue([
    harness('claude-code', { managed: true, byo: true }, true),
    harness('codex', { managed: true, byo: true }, false),
  ]);
  resolveServingTarget.mockResolvedValue({
    providerSlug: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.6',
  });
});

describe('resolveTaskServing — gateway lane', () => {
  it('delegates an unpinned agent to the legacy walk, unpinned', async () => {
    const serving = await resolveTaskServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-sonnet-4.6',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
    });
    expect(resolveServingTarget).toHaveBeenCalledWith(
      ctx,
      ORG,
      'anthropic/claude-sonnet-4.6',
    );
  });

  it('serves a pin over a DIRECT default credential on the gateway lane', async () => {
    credentials = { openrouter: { status: 'active', authMethod: 'env' } };

    const serving = await resolveTaskServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-sonnet-4.6',
      modelProvider: 'openrouter',
      harness: 'claude-code',
    });

    // The pinned walk resolves to the catalog's own spelling; the unpinned
    // legacy door is never consulted.
    expect(serving).toEqual({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'claude-sonnet-4-6',
    });
    expect(resolveServingTarget).not.toHaveBeenCalled();
  });

  it('throws when the pin names an unconfigured provider', async () => {
    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'mistral',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/pins provider "mistral", which is not configured/);
  });

  it('throws when the pinned provider has no active default credential', async () => {
    credentials = {
      anthropic: { status: 'disabled', authMethod: 'subscription-broker' },
    };

    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no active default credential/);
  });
});

describe('resolveTaskServing — subscription lane', () => {
  it('serves a pinned broker default on the subscription lane', async () => {
    credentials = { anthropic: BROKER };

    const serving = await resolveTaskServing(ctx, {
      organizationId: ORG,
      model: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'subscription',
      providerSlug: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      apiBaseUrl: 'https://api.anthropic.com',
    });
    expect(resolveServingTarget).not.toHaveBeenCalled();
  });

  it('resolves an equivalent id to the pinned catalog spelling', async () => {
    credentials = { anthropic: BROKER };

    const serving = await resolveTaskServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-sonnet-4.6',
      modelProvider: 'anthropic',
      harness: 'claude-code',
    });

    expect(serving).toMatchObject({
      lane: 'subscription',
      modelId: 'claude-sonnet-4-6',
    });
  });

  it("prefers the auth entry's dedicated coding endpoint over the API base", async () => {
    credentials = {
      'z-ai': { status: 'active', authMethod: 'subscription-key' },
    };
    getProviderCatalog.mockResolvedValue([{ id: 'glm-5' }]);

    const serving = await resolveTaskServing(ctx, {
      organizationId: ORG,
      model: 'glm-5',
      modelProvider: 'z-ai',
      harness: 'claude-code',
    });

    expect(serving).toMatchObject({
      lane: 'subscription',
      apiBaseUrl: 'https://coding.z.ai/api/anthropic',
    });
  });

  it('refuses a harness other than the one the credential forces', async () => {
    credentials = { anthropic: BROKER };

    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        harness: 'codex',
      }),
    ).rejects.toThrow(/claude-code/);
  });

  it('refuses a harness with no subscription delivery channel', async () => {
    credentials = { anthropic: BROKER };
    loadHarnesses.mockReturnValue([
      // Same policy split, but claude-code ships no `subscription` section.
      harness('claude-code', { managed: true, byo: true }, false),
    ]);

    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no subscription delivery/);
  });

  it("honors the default credential's model allowlist", async () => {
    credentials = {
      anthropic: { ...BROKER, modelAllowlist: ['claude-haiku-4-5'] },
    };

    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/allowlist excludes it/);
  });

  it('throws when the pinned catalog does not list the model', async () => {
    credentials = { anthropic: BROKER };
    getProviderCatalog.mockResolvedValue([{ id: 'claude-haiku-4-5' }]);

    await expect(
      resolveTaskServing(ctx, {
        organizationId: ORG,
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/does not list model "claude-sonnet-4-6"/);
  });
});
