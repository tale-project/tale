import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProviderDefinition } from '../../../lib/shared/schemas/providers';
import type { ActionCtx } from '../lib/ctx';
import { resolveWorkflowAgentServing } from '../lib/providers/agent_serving';
import { getProviderCatalog } from '../lib/providers/catalog_fetch';
import { resolveProvidersForOrgId } from '../lib/providers/org_providers';
import { automationAgentHost } from './agent_host';

vi.mock('../lib/providers/agent_serving', () => ({
  resolveWorkflowAgentServing: vi.fn(),
}));
vi.mock('../lib/providers/org_providers', () => ({
  resolveProvidersForOrgId: vi.fn(),
}));
vi.mock('../lib/providers/catalog_fetch', () => ({
  getProviderCatalog: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
});

function context(visionAvailable: boolean) {
  vi.mocked(resolveWorkflowAgentServing).mockResolvedValue({
    lane: 'gateway',
    providerSlug: 'local-inference',
    modelId: 'text-model',
  });
  vi.mocked(resolveProvidersForOrgId).mockResolvedValue([
    { name: 'local-inference' } as ProviderDefinition,
  ]);
  const catalogEntry = {
    provider: 'local-inference',
    tags: ['chat'],
    supportsTools: true,
    contextWindow: 100_000,
  };
  vi.mocked(getProviderCatalog).mockResolvedValue([
    { ...catalogEntry, id: 'text-model', supportsVision: false },
    ...(visionAvailable
      ? [{ ...catalogEntry, id: 'exact-vision-model', supportsVision: true }]
      : []),
  ]);
  const runMutation = vi.fn(async () => null);
  const runAction = vi.fn(async () => null);
  const runAfter = vi.fn(async () => null);
  const ctx = {
    runQuery: vi.fn(async (_ref: unknown, args: { policyType?: string }) =>
      args.policyType
        ? { providerSlug: 'local-inference', modelId: 'exact-vision-model' }
        : { authMethod: 'api-key', status: 'active' },
    ),
    runMutation,
    runAction,
    scheduler: { runAfter },
  } as unknown as ActionCtx;
  return { ctx, runMutation, runAction, runAfter };
}

const kick = {
  runId: 'synthetic-run',
  nodeId: 'read-invoices',
  request: {
    model: 'text-model',
    modelProvider: 'local-inference',
    harness: 'claude-code',
    prompt: 'Read the synthetic invoice.',
  },
};

describe('automation agent vision admission', () => {
  it('fails a missing pinned vision model before any op, key, schedule or inference starts', async () => {
    const { ctx, runMutation, runAction, runAfter } = context(false);
    await expect(
      automationAgentHost(ctx, 'synthetic-org').kick(kick),
    ).rejects.toMatchObject({ code: 'VISION_MODEL_UNAVAILABLE' });
    expect(runMutation).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it('carries the exact successful pin into the scheduled turn', async () => {
    const { ctx, runMutation, runAction, runAfter } = context(true);
    await automationAgentHost(ctx, 'synthetic-org').kick(kick);
    expect(resolveWorkflowAgentServing).toHaveBeenCalledWith(ctx, {
      organizationId: 'synthetic-org',
      model: 'text-model',
      modelProvider: 'local-inference',
      harness: 'claude-code',
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runAction).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledExactlyOnceWith(
      0,
      expect.anything(),
      expect.objectContaining({
        organizationId: 'synthetic-org',
        runId: 'synthetic-run',
        visionProviderSlug: 'local-inference',
        visionModelId: 'exact-vision-model',
        providerSlug: 'local-inference',
        modelId: 'text-model',
      }),
    );
  });
});
