import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import {
  normalizeCatalogModel,
  type NormalizedCapability,
} from '../lib/agent_response/model_capabilities/normalize';
import schema from '../schema';

// convex-test module map keyed relative to convex/ root. This file lives at
// convex/model_catalog/.
const TEST_DIR_FROM_CONVEX_ROOT = 'model_catalog';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

type T = TestConvex<typeof schema>;

// A realistic OpenRouter entry → normalizes WITH displayName + isChat present.
const RAW_OPENROUTER = {
  id: 'anthropic/claude-opus-4',
  name: 'Anthropic: Claude Opus 4',
  pricing: { prompt: '0.000015', completion: '0.000075' },
  context_length: 200000,
  architecture: {
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
  },
  supported_parameters: ['tools', 'reasoning'],
};

/** Drop the non-cache fields exactly as runRefresh does before upserting. */
function projectForUpsert(
  entry: NormalizedCapability,
): Omit<NormalizedCapability, 'displayName' | 'isChat'> {
  const { displayName: _displayName, isChat: _isChat, ...row } = entry;
  return row;
}

describe('model-catalog normalize → upsert → query round trip', () => {
  it('normalized entry carries displayName + isChat (the fields the cache must NOT store)', () => {
    const norm = normalizeCatalogModel(RAW_OPENROUTER);
    expect(norm?.displayName).toBe('Anthropic: Claude Opus 4');
    expect(norm?.isChat).toBe(true);
  });

  it('upsert rejects the raw normalized entry (extra fields) but accepts the projected row', async () => {
    const t: T = convexTest(schema, modules);
    const norm = normalizeCatalogModel(RAW_OPENROUTER);
    if (!norm) throw new Error('normalize returned null');

    // Raw entry (with displayName/isChat) must be rejected by the strict
    // arg validator — this is the bug that left the cache permanently empty.
    await expect(
      t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
        source: 'openrouter',
        fetchedAt: 1,
        entries: [norm],
      }),
    ).rejects.toThrow();

    // Projected row (sync's `runRefresh` behaviour) is accepted and persisted.
    await t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
      source: 'openrouter',
      fetchedAt: 2,
      entries: [projectForUpsert(norm)],
    });

    const cap = await t.query(
      internal.model_catalog.queries.getModelCapabilityInternal,
      { modelId: 'anthropic/claude-opus-4' },
    );
    expect(cap).not.toBeNull();
    expect(cap?.contextWindow).toBe(200000);
    expect(cap?.supportsVision).toBe(true);
    expect(cap?.supportsTools).toBe(true);
    expect(cap?.outputCentsPerMillion).toBeGreaterThan(0);
  });
});
