import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/server', () => ({
  internalQuery: (config: Record<string, unknown>) => config,
}));

vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
    },
  };
});

import {
  evaluatePersonalizationGates,
  isPersonalizationEnabled,
} from '../internal_queries';

interface PolicyRow {
  organizationId: string;
  policyType: string;
  enabled?: boolean;
  config: unknown;
}

interface PrefsRow {
  userId: string;
  organizationId: string;
  enabled?: boolean;
}

interface ThreadMetaRow {
  threadId: string;
  disablePersonalization?: boolean;
}

function createCtx(opts: {
  policies?: PolicyRow[];
  prefs?: PrefsRow[];
  threadMeta?: ThreadMetaRow[];
}) {
  const policies = opts.policies ?? [];
  const prefs = opts.prefs ?? [];
  const threadMeta = opts.threadMeta ?? [];

  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === 'governancePolicies') {
          return {
            withIndex: (_name: string, cb: (q: unknown) => unknown) => {
              // The lib produces nested .eq calls; capture both arguments
              // by intercepting them on a stub that records key/value.
              const captured: Record<string, unknown> = {};
              const builder = {
                eq: (k: string, v: unknown) => {
                  captured[k] = v;
                  return builder;
                },
              };
              cb(builder);
              return {
                first: async () =>
                  policies.find(
                    (p) =>
                      p.organizationId === captured.organizationId &&
                      p.policyType === captured.policyType,
                  ) ?? null,
              };
            },
          };
        }
        if (table === 'userPreferences') {
          return {
            withIndex: (_name: string, cb: (q: unknown) => unknown) => {
              const captured: Record<string, unknown> = {};
              const builder = {
                eq: (k: string, v: unknown) => {
                  captured[k] = v;
                  return builder;
                },
              };
              cb(builder);
              return {
                first: async () =>
                  prefs.find(
                    (p) =>
                      p.userId === captured.userId &&
                      p.organizationId === captured.organizationId,
                  ) ?? null,
              };
            },
          };
        }
        if (table === 'threadMetadata') {
          return {
            withIndex: (_name: string, cb: (q: unknown) => unknown) => {
              const captured: Record<string, unknown> = {};
              const builder = {
                eq: (k: string, v: unknown) => {
                  captured[k] = v;
                  return builder;
                },
              };
              cb(builder);
              return {
                first: async () =>
                  threadMeta.find((m) => m.threadId === captured.threadId) ??
                  null,
              };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    },
  } as unknown as Parameters<typeof isPersonalizationEnabled>[0];
}

const ORG = 'o_1';
const USER = 'u_1';
const THREAD = 't_1';

describe('isPersonalizationEnabled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when there is no policy row', async () => {
    const ctx = createCtx({});
    expect(await isPersonalizationEnabled(ctx, ORG)).toBe(false);
  });

  it('returns false when policy row has enabled:false in config', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'personalization',
          config: { enabled: false },
        },
      ],
    });
    expect(await isPersonalizationEnabled(ctx, ORG)).toBe(false);
  });

  it('returns true when policy row has enabled:true in config', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'personalization',
          config: { enabled: true },
        },
      ],
    });
    expect(await isPersonalizationEnabled(ctx, ORG)).toBe(true);
  });

  it('returns false when row exists but row-level enabled is false (full kill)', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'personalization',
          enabled: false,
          config: { enabled: true },
        },
      ],
    });
    expect(await isPersonalizationEnabled(ctx, ORG)).toBe(false);
  });

  it('does NOT honor legacy feature_flags + personalization_v1 row (regression guard)', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'feature_flags',
          config: { personalization_v1: true, enabled: true, rules: [] },
        },
      ],
    });
    expect(await isPersonalizationEnabled(ctx, ORG)).toBe(false);
  });
});

describe('evaluatePersonalizationGates', () => {
  beforeEach(() => vi.clearAllMocks());

  const orgOn: PolicyRow = {
    organizationId: ORG,
    policyType: 'personalization',
    config: { enabled: true },
  };

  it('org=ON, user=undefined → true (member inherits org default)', async () => {
    const ctx = createCtx({ policies: [orgOn] });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(true);
  });

  it('org=ON, user=true → true', async () => {
    const ctx = createCtx({
      policies: [orgOn],
      prefs: [{ userId: USER, organizationId: ORG, enabled: true }],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(true);
  });

  it('org=ON, user=false → false (explicit opt-out beats org)', async () => {
    const ctx = createCtx({
      policies: [orgOn],
      prefs: [{ userId: USER, organizationId: ORG, enabled: false }],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(false);
  });

  it('org=OFF, user=undefined → false', async () => {
    const ctx = createCtx({});
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(false);
  });

  it('org=OFF, user=true → true (explicit opt-in beats org)', async () => {
    const ctx = createCtx({
      prefs: [{ userId: USER, organizationId: ORG, enabled: true }],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(true);
  });

  it('thread disablePersonalization vetoes everything', async () => {
    const ctx = createCtx({
      policies: [orgOn],
      prefs: [{ userId: USER, organizationId: ORG, enabled: true }],
      threadMeta: [{ threadId: THREAD, disablePersonalization: true }],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toBe(false);
  });

  it('omits thread arg → only org+user matter', async () => {
    const ctx = createCtx({ policies: [orgOn] });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
      }),
    ).toBe(true);
  });
});
