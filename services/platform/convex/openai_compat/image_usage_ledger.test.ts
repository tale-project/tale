import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';
import type { ApiImageResult } from './image_generation';
import { recordImageUsageAndAudit } from './internal_actions';

/**
 * Regression: an image-generation model with no per-image price, no
 * gateway-billed USD, and zero token usage used to write NO usageLedger row —
 * so `requestCount` never incremented and a per-API-key `maxRequests` (or
 * `maxCostCents`) budget could not cap it. The request is the billable unit for
 * an image, so the ledger row must always land.
 *
 * `recordImageUsageAndAudit` makes two `ctx.runMutation` calls when it records:
 * the usage-ledger increment (carries `costEstimateCents`) and the audit-log
 * write (does not). We assert the ledger call happens even for an unpriced,
 * zero-token result.
 */

function unpricedZeroTokenImage(): ApiImageResult {
  return {
    persisted: [],
    blobs: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    // No providerCostUsd, no costCents — the unpriced-model case.
    costCents: undefined,
    modelId: 'test/image-model',
    providerName: 'test',
    clamped: false,
  };
}

function ledgerCalls(runMutation: ReturnType<typeof vi.fn>): unknown[] {
  return runMutation.mock.calls
    .map((call) => call[1])
    .filter(
      (args): args is Record<string, unknown> =>
        typeof args === 'object' &&
        args !== null &&
        'costEstimateCents' in args,
    );
}

describe('recordImageUsageAndAudit — image request always counted', () => {
  it('writes a usage-ledger row even when cost is unknown and tokens are zero', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runMutation } as unknown as ActionCtx;

    await recordImageUsageAndAudit(ctx, {
      requestId: 'img-test',
      action: 'ai.image_generation',
      organizationId: 'org1',
      userId: 'user1',
      apiKeyId: 'key1',
      img: unpricedZeroTokenImage(),
    });

    const ledger = ledgerCalls(runMutation);
    expect(ledger).toHaveLength(1);
    // Attributed to the authenticating key, cost defaulted to 0 — the row's
    // value is the request it represents, which increments requestCount.
    expect(ledger[0]).toMatchObject({
      organizationId: 'org1',
      apiKeyId: 'key1',
      costEstimateCents: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it('attributes a priced image to its key with the derived cost', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runMutation } as unknown as ActionCtx;

    await recordImageUsageAndAudit(ctx, {
      requestId: 'img-test-2',
      action: 'ai.image_generation',
      organizationId: 'org1',
      userId: 'user1',
      apiKeyId: 'key1',
      img: { ...unpricedZeroTokenImage(), costCents: 42 },
    });

    const ledger = ledgerCalls(runMutation);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      apiKeyId: 'key1',
      costEstimateCents: 42,
    });
  });

  it('skips the ledger when there is no organization', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = { runMutation } as unknown as ActionCtx;

    await recordImageUsageAndAudit(ctx, {
      requestId: 'img-test-3',
      action: 'ai.image_generation',
      organizationId: '',
      userId: 'user1',
      img: unpricedZeroTokenImage(),
    });

    expect(ledgerCalls(runMutation)).toHaveLength(0);
  });
});
