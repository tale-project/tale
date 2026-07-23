import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderConnector } from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../../_generated/server';
import { getConnectorCatalog } from './catalog_fetch';
import { resolveConnectorsForOrgId } from './org_connectors';
import { resolveOrgVisionModel } from './resolve_vision_model';

vi.mock('./org_connectors', () => ({
  resolveConnectorsForOrgId: vi.fn(),
}));
vi.mock('./catalog_fetch', () => ({
  getConnectorCatalog: vi.fn(),
}));

const mockedResolveConnectors = vi.mocked(resolveConnectorsForOrgId);
const mockedCatalog = vi.mocked(getConnectorCatalog);

function connector(name: string) {
  return {
    name,
    displayName: name,
    apiFormat: 'openai',
    baseUrl: `https://${name}.example.com/v1`,
    catalog: { source: 'static' },
    auth: [{ method: 'api-key' }],
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal connector shape for a unit test
  } as unknown as ProviderConnector;
}

/** The resolver walks whatever connector set the org resolves to. */
function mockConnectors(connectors: ProviderConnector[]): void {
  mockedResolveConnectors.mockResolvedValue(connectors);
}

interface FakeCredentialRow {
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  status: 'active' | 'disabled';
  modelAllowlist?: string[];
}

/** Fake ActionCtx serving getDefaultCredentialInternal per provider slug. */
function fakeCtx(rows: Record<string, FakeCredentialRow | null>): ActionCtx {
  const runQuery = vi.fn(
    async (_ref: unknown, args: { providerSlug: string }) =>
      rows[args.providerSlug] ?? null,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only runQuery is exercised by this module
  return { runQuery } as unknown as ActionCtx;
}

function entry(args: {
  id: string;
  vision?: boolean;
  tags?: string[];
  inputPrice?: number;
}) {
  return {
    id: args.id,
    provider: 'x',
    tags: args.tags ?? ['chat'],
    supportsTools: true,
    supportsVision: args.vision ?? true,
    contextWindow: 100_000,
    ...(args.inputPrice !== undefined && {
      pricing: {
        inputCentsPerMillion: args.inputPrice,
        outputCentsPerMillion: args.inputPrice * 2,
      },
    }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveOrgVisionModel', () => {
  it('picks the cheapest vision-capable chat model across active default credentials', async () => {
    mockConnectors([connector('alpha'), connector('beta')]);
    mockedCatalog.mockImplementation(async (c) =>
      c.name === 'alpha'
        ? [
            entry({ id: 'pricey-vl', inputPrice: 500 }),
            entry({ id: 'text-only', vision: false, inputPrice: 1 }),
          ]
        : [entry({ id: 'cheap-vl', inputPrice: 20 })],
    );
    const ctx = fakeCtx({
      alpha: { authMethod: 'api-key', status: 'active' },
      beta: { authMethod: 'env', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'beta',
      modelId: 'cheap-vl',
    });
  });

  it('skips providers without an active, gateway-servable default credential', async () => {
    mockConnectors([
      connector('none'),
      connector('disabled'),
      connector('broker'),
      connector('good'),
    ]);
    mockedCatalog.mockResolvedValue([entry({ id: 'vl', inputPrice: 10 })]);
    const ctx = fakeCtx({
      none: null,
      disabled: { authMethod: 'api-key', status: 'disabled' },
      broker: { authMethod: 'subscription-broker', status: 'active' },
      good: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'good',
      modelId: 'vl',
    });
    // Only the one eligible provider's catalog was consulted at all.
    expect(mockedCatalog).toHaveBeenCalledTimes(1);
  });

  it("respects the default credential's model allowlist", async () => {
    mockConnectors([connector('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'cheap-vl', inputPrice: 1 }),
      entry({ id: 'allowed-vl', inputPrice: 100 }),
    ]);
    const ctx = fakeCtx({
      alpha: {
        authMethod: 'api-key',
        status: 'active',
        modelAllowlist: ['allowed-vl'],
      },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'allowed-vl',
    });
  });

  it('a failing catalog skips that provider, not the whole resolution', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockConnectors([connector('flaky'), connector('good')]);
    mockedCatalog.mockImplementation(async (c) => {
      if (c.name === 'flaky') throw new Error('endpoint down');
      return [entry({ id: 'vl', inputPrice: 10 })];
    });
    const ctx = fakeCtx({
      flaky: { authMethod: 'api-key', status: 'active' },
      good: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'good',
      modelId: 'vl',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('catalog for flaky unavailable'),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('returns null when nothing vision-capable is reachable', async () => {
    mockConnectors([connector('alpha')]);
    mockedCatalog.mockResolvedValue([
      entry({ id: 'text-only', vision: false }),
      entry({ id: 'embed', vision: true, tags: ['embedding'] }),
    ]);
    const ctx = fakeCtx({
      alpha: { authMethod: 'api-key', status: 'active' },
    });
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toBeNull();
  });

  it('ranks unpriced entries last and tie-breaks deterministically', async () => {
    mockConnectors([connector('zeta'), connector('alpha')]);
    mockedCatalog.mockImplementation(async (c) =>
      c.name === 'zeta'
        ? [entry({ id: 'vl-z', inputPrice: 10 }), entry({ id: 'unpriced' })]
        : [entry({ id: 'vl-a', inputPrice: 10 })],
    );
    const ctx = fakeCtx({
      zeta: { authMethod: 'api-key', status: 'active' },
      alpha: { authMethod: 'api-key', status: 'active' },
    });
    // Same price on two providers → the lexically smaller provider wins,
    // regardless of connector iteration order.
    await expect(resolveOrgVisionModel(ctx, 'org_1')).resolves.toEqual({
      providerSlug: 'alpha',
      modelId: 'vl-a',
    });
  });
});
