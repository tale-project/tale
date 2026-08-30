// @vitest-environment node

/**
 * The agent-turn serving resolution, off the wire. Unpinned: the DIRECT pass
 * keeps today's serving (and its billing lane) for any org that serves the
 * model directly, the SUBSCRIPTION pass serves a broker/key default only when
 * the shared sanction approves the harness pair, and every dead end names the
 * problem. Pinned (`modelProvider`): the shared fail-closed split — the pin
 * decides the provider outright, and a pin that cannot serve throws instead
 * of falling back to a connector that could. The task lane's delegation onto
 * the same split is proven in `tasks/task_serving.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  harnessDefinitionSchema,
  providerDefinitionSchema,
  type ProviderDefinition,
} from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../ctx';

const { getProviderCatalog, resolveConnectors, loadHarnesses } = vi.hoisted(
  () => ({
    getProviderCatalog: vi.fn(),
    resolveConnectors: vi.fn(),
    loadHarnesses: vi.fn(),
  }),
);

vi.mock('./catalog_fetch', () => ({ getProviderCatalog }));
vi.mock('./org_providers', () => ({
  resolveProvidersForOrgId: resolveConnectors,
}));
vi.mock('./load_system_config', () => ({ loadHarnesses }));

import { resolveWorkflowAgentServing } from './agent_serving';

const ORG = 'org_agent_serving';

/** Parsed through the schema so the fixture can never drift from the shape
 * the loader would deliver (same convention as task_serving.test.ts). */
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

const runQuery = vi.fn((_ref: unknown, args: { providerSlug: string }) =>
  Promise.resolve(credentials[args.providerSlug] ?? null),
);
const ctx = { runQuery } as unknown as ActionCtx;

const BROKER = { status: 'active', authMethod: 'subscription-broker' };
const DIRECT = { status: 'active', authMethod: 'api-key' };

beforeEach(() => {
  vi.clearAllMocks();
  credentials = {};
  resolveConnectors.mockResolvedValue([ANTHROPIC, OPENROUTER, ZAI]);
  getProviderCatalog.mockResolvedValue([{ id: 'claude-fable-5' }]);
  loadHarnesses.mockReturnValue([
    harness('claude-code', { managed: true, byo: true }, true),
    harness('codex', { managed: true, byo: true }, false),
  ]);
});

describe('resolveWorkflowAgentServing — direct pass', () => {
  it('serves a directly-served model on the gateway lane', async () => {
    credentials = { openrouter: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'openrouter'
            ? [{ id: 'anthropic/claude-fable-5' }]
            : [],
        ),
    );

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-fable-5',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
    });
  });

  it('keeps a direct serving even when an earlier connector holds a broker default', async () => {
    // The org serves the model via OpenRouter today; adding an Anthropic
    // broker credential must not silently move the serving (and billing) to
    // the subscription lane.
    credentials = { anthropic: BROKER, openrouter: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'openrouter'
            ? [{ id: 'anthropic/claude-fable-5' }]
            : [{ id: 'claude-fable-5' }],
        ),
    );

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-fable-5',
      harness: 'claude-code',
    });

    expect(serving.lane).toBe('gateway');
    expect(serving.providerSlug).toBe('openrouter');
  });
});

describe('resolveWorkflowAgentServing — subscription pass', () => {
  it('serves a broker-only org on the subscription lane', async () => {
    credentials = { anthropic: BROKER };

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'claude-fable-5',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'subscription',
      providerSlug: 'anthropic',
      modelId: 'claude-fable-5',
      apiBaseUrl: 'https://api.anthropic.com',
    });
  });

  it('never re-queries a credential the direct pass already fetched', async () => {
    credentials = { anthropic: BROKER };

    await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'claude-fable-5',
      harness: 'claude-code',
    });

    // One default-credential read per connector, shared across both passes.
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  it('resolves an equivalent id to the serving catalog spelling', async () => {
    credentials = { anthropic: BROKER };

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'anthropic/claude-fable-5',
      harness: 'claude-code',
    });

    expect(serving).toMatchObject({
      lane: 'subscription',
      modelId: 'claude-fable-5',
    });
  });

  it("prefers the auth entry's dedicated coding endpoint over the API base", async () => {
    credentials = {
      'z-ai': { status: 'active', authMethod: 'subscription-key' },
    };
    getProviderCatalog.mockResolvedValue([{ id: 'glm-5' }]);

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'glm-5',
      harness: 'claude-code',
    });

    expect(serving).toMatchObject({
      lane: 'subscription',
      providerSlug: 'z-ai',
      apiBaseUrl: 'https://coding.z.ai/api/anthropic',
    });
  });

  it('refuses a harness other than the one the credential forces, naming it', async () => {
    credentials = { anthropic: BROKER };

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        harness: 'codex',
      }),
    ).rejects.toThrow(/"anthropic".*claude-code/s);
  });

  it('refuses a harness with no subscription delivery channel', async () => {
    credentials = { anthropic: BROKER };
    loadHarnesses.mockReturnValue([
      // Same policy split, but claude-code ships no `subscription` section.
      harness('claude-code', { managed: true, byo: true }, false),
    ]);

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no subscription delivery/);
  });

  it("honors the default credential's model allowlist", async () => {
    credentials = {
      anthropic: { ...BROKER, modelAllowlist: ['claude-haiku-4-5'] },
    };

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no configured provider serves model "claude-fable-5"/);
  });

  it('skips a subscription connector whose catalog does not list the model', async () => {
    credentials = { anthropic: BROKER };
    getProviderCatalog.mockResolvedValue([{ id: 'claude-haiku-4-5' }]);

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no configured provider serves model "claude-fable-5"/);
  });

  it('reports an unreachable catalog instead of failing the walk on it', async () => {
    credentials = { anthropic: BROKER };
    getProviderCatalog.mockRejectedValue(new Error('catalog fetch timed out'));

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/the catalog for "anthropic" was unreachable/);
  });
});

describe('resolveWorkflowAgentServing — pinned', () => {
  /** Both lanes live: OpenRouter serves the model on a direct key AND
   * Anthropic holds a broker default — the constellation where the unpinned
   * walk lands on OpenRouter. */
  function bothLanesServe() {
    credentials = { anthropic: BROKER, openrouter: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'openrouter'
            ? [{ id: 'anthropic/claude-fable-5' }]
            : [{ id: 'claude-fable-5' }],
        ),
    );
  }

  it('serves a pinned subscription default even when a direct connector lists the model', async () => {
    bothLanesServe();

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'claude-fable-5',
      modelProvider: 'anthropic',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'subscription',
      providerSlug: 'anthropic',
      modelId: 'claude-fable-5',
      apiBaseUrl: 'https://api.anthropic.com',
    });
  });

  it('serves a pinned direct default on the gateway lane, in its catalog spelling', async () => {
    bothLanesServe();

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'claude-fable-5',
      modelProvider: 'openrouter',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
    });
  });

  it('honors a direct pin over the unpinned walk order', async () => {
    // Both connectors hold direct credentials; unpinned, anthropic (first in
    // shipped order) would win — the pin routes to the one the author chose.
    credentials = { anthropic: DIRECT, openrouter: DIRECT };
    getProviderCatalog.mockImplementation(
      (connector: { name: string }): Promise<Array<{ id: string }>> =>
        Promise.resolve(
          connector.name === 'openrouter'
            ? [{ id: 'anthropic/claude-fable-5' }]
            : [{ id: 'claude-fable-5' }],
        ),
    );

    const serving = await resolveWorkflowAgentServing(ctx, {
      organizationId: ORG,
      model: 'claude-fable-5',
      modelProvider: 'openrouter',
      harness: 'claude-code',
    });

    expect(serving).toEqual({
      lane: 'gateway',
      providerSlug: 'openrouter',
      modelId: 'anthropic/claude-fable-5',
    });
  });

  it('never falls back to another provider when the pin cannot serve', async () => {
    // OpenRouter could serve this model directly — a refused anthropic pin
    // (codex is not the broker credential's forced harness) must throw, not
    // quietly route (and bill) the turn through OpenRouter.
    bothLanesServe();

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        modelProvider: 'anthropic',
        harness: 'codex',
      }),
    ).rejects.toThrow(/claude-code/);
  });

  it('throws when the pin names an unconfigured provider', async () => {
    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
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
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        modelProvider: 'anthropic',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(/no active default credential/);
  });

  it('throws when the pinned direct catalog does not list the model', async () => {
    credentials = { openrouter: DIRECT };
    getProviderCatalog.mockResolvedValue([{ id: 'gpt-5' }]);

    await expect(
      resolveWorkflowAgentServing(ctx, {
        organizationId: ORG,
        model: 'claude-fable-5',
        modelProvider: 'openrouter',
        harness: 'claude-code',
      }),
    ).rejects.toThrow(
      /provider "openrouter" cannot serve model "claude-fable-5"/,
    );
  });
});
