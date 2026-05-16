import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    personalization: {
      internal_queries: {
        getPersonalizationDataForInjection:
          'getPersonalizationDataForInjection',
      },
    },
  },
}));

import { buildUserPersonalization } from './build_user_personalization';

interface PersonalizationData {
  effective: boolean;
  preferences: {
    customInstructions: string;
    enabled?: boolean;
  } | null;
  memories: {
    _id: string;
    content: string;
    createdAt: number;
  }[];
}

function createCtx(data: PersonalizationData) {
  const ctx = {
    runQuery: vi.fn(async () => data),
  };
  return ctx as unknown as Parameters<
    typeof import('./build_user_personalization').buildUserPersonalization
  >[0] & { runQuery: typeof ctx.runQuery };
}

const ARGS = {
  userId: 'u_1',
  organizationId: 'o_1',
  threadId: 't_1',
  agentConfig: { personalizationMode: 'on' as const },
};

describe('buildUserPersonalization gating', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns EMPTY when agent personalizationMode is off (no DB read)', async () => {
    const ctx = createCtx({
      effective: true,
      preferences: { customInstructions: 'hi', enabled: true },
      memories: [{ _id: 'm', content: 'x', createdAt: 0 }],
    });
    const result = await buildUserPersonalization(ctx, {
      ...ARGS,
      agentConfig: { personalizationMode: 'off' },
    });
    expect(result.text).toBe('');
    expect(result.injectedMemoryIds).toEqual([]);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('returns EMPTY when effective is false (gate closed)', async () => {
    const ctx = createCtx({
      effective: false,
      preferences: { customInstructions: 'hi', enabled: true },
      memories: [{ _id: 'm', content: 'x', createdAt: 0 }],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('returns EMPTY when there is no preferences row and no memories', async () => {
    const ctx = createCtx({
      effective: true,
      preferences: null,
      memories: [],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('injects memories when effective is true even without a prefs row (org default ON, user untouched)', async () => {
    const ctx = createCtx({
      effective: true,
      preferences: null,
      memories: [
        {
          _id: 'mem_inherit',
          content: 'likes pizza',
          createdAt: 1700000000000,
        },
      ],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toContain('<user_memories');
    expect(result.text).toContain('likes pizza');
    expect(result.injectedMemoryIds).toEqual(['mem_inherit']);
  });

  it('injects custom instructions and memories when effective is true', async () => {
    const ctx = createCtx({
      effective: true,
      preferences: { customInstructions: 'reply concisely', enabled: true },
      memories: [
        { _id: 'mem_1', content: 'loves chess', createdAt: 1700000000000 },
      ],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toContain('<user_custom_instructions');
    expect(result.text).toContain('reply concisely');
    expect(result.text).toContain('<user_memories');
    expect(result.text).toContain('loves chess');
    expect(result.injectedMemoryIds).toEqual(['mem_1']);
  });

  it('produces identical output for identical input (deterministic nonce)', async () => {
    const data: PersonalizationData = {
      effective: true,
      preferences: { customInstructions: 'be terse', enabled: true },
      memories: [
        { _id: 'mem_a', content: 'lives in PT', createdAt: 1700000000000 },
        { _id: 'mem_b', content: 'prefers Go', createdAt: 1700000001000 },
      ],
    };
    const r1 = await buildUserPersonalization(createCtx(data), ARGS);
    const r2 = await buildUserPersonalization(createCtx(data), ARGS);
    expect(r1.text).toBe(r2.text);
    expect(r1.fingerprint).toBe(r2.fingerprint);
  });
});
