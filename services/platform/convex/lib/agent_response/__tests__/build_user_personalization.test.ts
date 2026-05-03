import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    personalization: {
      internal_queries: {
        getPersonalizationDataForInjection:
          'getPersonalizationDataForInjection',
      },
    },
  },
}));

import { buildUserPersonalization } from '../build_user_personalization';

interface PersonalizationData {
  orgEnabled: boolean;
  threadDisablePersonalization: boolean;
  preferences: {
    customInstructions: string;
    enabled: boolean;
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
    typeof import('../build_user_personalization').buildUserPersonalization
  >[0] & { runQuery: typeof ctx.runQuery };
}

const ARGS = {
  userId: 'u_1',
  organizationId: 'o_1',
  threadId: 't_1',
  agentConfig: { personalizationMode: 'on' as const },
};

describe('buildUserPersonalization kill switches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns EMPTY when agent personalizationMode is off (no DB read)', async () => {
    const ctx = createCtx({
      orgEnabled: true,
      threadDisablePersonalization: false,
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

  it('returns EMPTY when org feature flag is off', async () => {
    const ctx = createCtx({
      orgEnabled: false,
      threadDisablePersonalization: false,
      preferences: { customInstructions: 'hi', enabled: true },
      memories: [],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('returns EMPTY when thread has disablePersonalization', async () => {
    const ctx = createCtx({
      orgEnabled: true,
      threadDisablePersonalization: true,
      preferences: { customInstructions: 'hi', enabled: true },
      memories: [],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('returns EMPTY when there is no preferences row (default-OFF)', async () => {
    const ctx = createCtx({
      orgEnabled: true,
      threadDisablePersonalization: false,
      preferences: null,
      memories: [{ _id: 'm', content: 'x', createdAt: 0 }],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('returns EMPTY when prefs.enabled is false', async () => {
    const ctx = createCtx({
      orgEnabled: true,
      threadDisablePersonalization: false,
      preferences: { customInstructions: 'hi', enabled: false },
      memories: [{ _id: 'm', content: 'x', createdAt: 0 }],
    });
    const result = await buildUserPersonalization(ctx, ARGS);
    expect(result.text).toBe('');
  });

  it('injects custom instructions and memories when all gates open', async () => {
    const ctx = createCtx({
      orgEnabled: true,
      threadDisablePersonalization: false,
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
      orgEnabled: true,
      threadDisablePersonalization: false,
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
