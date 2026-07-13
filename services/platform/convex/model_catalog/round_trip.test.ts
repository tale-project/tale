import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
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

  it('clears a poisoned maxOutputTokens for one modelId', async () => {
    const t: T = convexTest(schema, modules);
    await t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
      source: 'openrouter',
      fetchedAt: 1,
      entries: [
        {
          modelId: 'z-ai/glm-5.2',
          contextWindow: 1048576,
          maxOutputTokens: 1048576,
        },
      ],
    });
    await t.mutation(
      internal.model_catalog.mutations.clearModelMaxOutputTokens,
      { modelId: 'z-ai/glm-5.2' },
    );
    const cap = await t.query(
      internal.model_catalog.queries.getModelCapabilityInternal,
      { modelId: 'z-ai/glm-5.2' },
    );
    expect(cap?.contextWindow).toBe(1048576);
    expect(cap?.maxOutputTokens).toBeUndefined();
  });

  it('re-sync without maxOutputTokens clears a prior poisoned value', async () => {
    const t: T = convexTest(schema, modules);
    await t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
      source: 'openrouter',
      fetchedAt: 1,
      entries: [
        {
          modelId: 'z-ai/glm-5.2',
          contextWindow: 1048576,
          maxOutputTokens: 1048576,
        },
      ],
    });
    await t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
      source: 'openrouter',
      fetchedAt: 2,
      entries: [{ modelId: 'z-ai/glm-5.2', contextWindow: 1048576 }],
    });
    const cap = await t.query(
      internal.model_catalog.queries.getModelCapabilityInternal,
      { modelId: 'z-ai/glm-5.2' },
    );
    expect(cap?.maxOutputTokens).toBeUndefined();
    expect(cap?.contextWindow).toBe(1048576);
  });
});

// A second realistic entry so the list query has something to sort.
const RAW_OPENROUTER_2 = {
  id: 'openai/gpt-4o',
  name: 'OpenAI: GPT-4o',
  pricing: { prompt: '0.0000025', completion: '0.00001' },
  context_length: 128000,
  architecture: {
    input_modalities: ['text', 'image'],
    output_modalities: ['text'],
  },
  supported_parameters: ['tools'],
};

describe('listCatalogModels (settings model picker, #2655)', () => {
  async function seedCatalog(t: T): Promise<void> {
    const entries = [RAW_OPENROUTER_2, RAW_OPENROUTER].map((raw) => {
      const norm = normalizeCatalogModel(raw);
      if (!norm) throw new Error('normalize returned null');
      return projectForUpsert(norm);
    });
    await t.mutation(internal.model_catalog.mutations.upsertCapabilities, {
      source: 'openrouter',
      fetchedAt: 1,
      entries,
    });
  }

  it('returns the whole cache with capabilities, sorted by modelId, for an org member', async () => {
    const t: T = convexTest(schema, modules);
    // Seed the local member mirror so the org-membership gate resolves without
    // the (test-unavailable) Better Auth component — mirrors tasks/queries.test.ts.
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: 'm_user_1',
        userId: 'user_1',
        organizationId: 'org-1',
        role: 'member',
        createdAt: 0,
      });
    });
    await seedCatalog(t);

    const rows = await t
      .withIdentity({ subject: 'user_1' })
      .query(api.model_catalog.queries.listCatalogModels, {
        organizationId: 'org-1',
      });
    // Seeded openai/* first — the query must return modelId-sorted rows.
    expect(rows.map((r) => r.modelId)).toEqual([
      'anthropic/claude-opus-4',
      'openai/gpt-4o',
    ]);
    // Capability facts ride along so selecting a model can fill them.
    expect(rows[0].contextWindow).toBe(200000);
    expect(rows[0].supportsVision).toBe(true);
    expect(rows[1].supportsTools).toBe(true);
  });

  it('rejects an unauthenticated caller', async () => {
    const t: T = convexTest(schema, modules);
    await seedCatalog(t);
    await expect(
      t.query(api.model_catalog.queries.listCatalogModels, {
        organizationId: 'org-1',
      }),
    ).rejects.toThrow();
  });
});
