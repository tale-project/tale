import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', () => ({
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
  isCustomInstructionsEnabledForOrg,
  isMemoriesEnabledForOrg,
} from './internal_queries';

interface PolicyRow {
  organizationId: string;
  policyType: string;
  enabled?: boolean;
  config: unknown;
}

interface PrefsRow {
  userId: string;
  organizationId: string;
  customInstructionsEnabled?: boolean;
  memoriesEnabled?: boolean;
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
        if (table === 'configCache') {
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
                  captured.domain === 'governance'
                    ? (policies.find(
                        (p) =>
                          p.organizationId === captured.organizationId &&
                          p.policyType === captured.key,
                      ) ?? null)
                    : null,
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
  } as unknown as Parameters<typeof isCustomInstructionsEnabledForOrg>[0];
}

const ORG = 'o_1';
const USER = 'u_1';
const THREAD = 't_1';

function customOn(): PolicyRow {
  return {
    organizationId: ORG,
    policyType: 'custom_instructions',
    config: { enabled: true },
  };
}

function memoriesOn(): PolicyRow {
  return {
    organizationId: ORG,
    policyType: 'user_memories',
    config: { enabled: true },
  };
}

describe('isCustomInstructionsEnabledForOrg', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when there is no policy row', async () => {
    const ctx = createCtx({});
    expect(await isCustomInstructionsEnabledForOrg(ctx, ORG)).toBe(false);
  });

  it('returns false when config.enabled is false', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'custom_instructions',
          config: { enabled: false },
        },
      ],
    });
    expect(await isCustomInstructionsEnabledForOrg(ctx, ORG)).toBe(false);
  });

  it('returns true when config.enabled is true', async () => {
    const ctx = createCtx({ policies: [customOn()] });
    expect(await isCustomInstructionsEnabledForOrg(ctx, ORG)).toBe(true);
  });

  it('returns false when row-level enabled is false (full kill)', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'custom_instructions',
          enabled: false,
          config: { enabled: true },
        },
      ],
    });
    expect(await isCustomInstructionsEnabledForOrg(ctx, ORG)).toBe(false);
  });

  it('does NOT honor legacy combined `personalization` policy (regression guard)', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'personalization',
          config: { enabled: true },
        },
      ],
    });
    expect(await isCustomInstructionsEnabledForOrg(ctx, ORG)).toBe(false);
  });
});

describe('isMemoriesEnabledForOrg', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when there is no policy row', async () => {
    const ctx = createCtx({});
    expect(await isMemoriesEnabledForOrg(ctx, ORG)).toBe(false);
  });

  it('returns true when the user_memories policy enables it', async () => {
    const ctx = createCtx({ policies: [memoriesOn()] });
    expect(await isMemoriesEnabledForOrg(ctx, ORG)).toBe(true);
  });

  it('is independent of custom_instructions', async () => {
    const ctx = createCtx({ policies: [customOn()] });
    expect(await isMemoriesEnabledForOrg(ctx, ORG)).toBe(false);
  });
});

describe('evaluatePersonalizationGates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('both org defaults ON, no user prefs → both features inherit ON', async () => {
    const ctx = createCtx({ policies: [customOn(), memoriesOn()] });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toEqual({ customInstructions: true, memories: true });
  });

  it('user opts memories=false while org has both ON → memories gates off, instructions stay on', async () => {
    const ctx = createCtx({
      policies: [customOn(), memoriesOn()],
      prefs: [
        {
          userId: USER,
          organizationId: ORG,
          memoriesEnabled: false,
        },
      ],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toEqual({ customInstructions: true, memories: false });
  });

  it('org both OFF, user opts customInstructions=true → only instructions on', async () => {
    const ctx = createCtx({
      prefs: [
        {
          userId: USER,
          organizationId: ORG,
          customInstructionsEnabled: true,
        },
      ],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toEqual({ customInstructions: true, memories: false });
  });

  it('thread disablePersonalization vetoes both features', async () => {
    const ctx = createCtx({
      policies: [customOn(), memoriesOn()],
      prefs: [
        {
          userId: USER,
          organizationId: ORG,
          customInstructionsEnabled: true,
          memoriesEnabled: true,
        },
      ],
      threadMeta: [{ threadId: THREAD, disablePersonalization: true }],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toEqual({ customInstructions: false, memories: false });
  });

  it('omits thread arg → only org+user matter', async () => {
    const ctx = createCtx({ policies: [customOn(), memoriesOn()] });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
      }),
    ).toEqual({ customInstructions: true, memories: true });
  });

  it('legacy `personalization` policy is ignored (regression guard)', async () => {
    const ctx = createCtx({
      policies: [
        {
          organizationId: ORG,
          policyType: 'personalization',
          config: { enabled: true },
        },
      ],
    });
    expect(
      await evaluatePersonalizationGates(ctx, {
        userId: USER,
        organizationId: ORG,
        threadId: THREAD,
      }),
    ).toEqual({ customInstructions: false, memories: false });
  });
});
