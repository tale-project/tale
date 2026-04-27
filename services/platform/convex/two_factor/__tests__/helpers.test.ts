import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth:adapter:findMany',
      },
    },
  },
}));

const mockGetTwoFactorPolicy = vi.fn();
vi.mock('../../governance/helpers', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    getTwoFactorPolicy: (...args: unknown[]) => mockGetTwoFactorPolicy(...args),
  };
});

import { evaluateTwoFactorEnforcement } from '../helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

interface MockCtx {
  runQuery: ReturnType<typeof vi.fn>;
}

function createCtx(opts: {
  orgs?: string[];
  accountProviders?: string[];
}): MockCtx {
  const { orgs = ['org_1'], accountProviders = ['credential'] } = opts;
  const ctx = {
    runQuery: vi.fn(async (model: string, args: { model: string }) => {
      if (args.model === 'member') {
        return {
          page: orgs.map((organizationId) => ({ organizationId })),
        };
      }
      if (args.model === 'account') {
        return {
          page: accountProviders.map((providerId) => ({ providerId })),
        };
      }
      return { page: [] };
    }),
  };
  return ctx;
}

beforeEach(() => {
  mockGetTwoFactorPolicy.mockReset();
});

describe('evaluateTwoFactorEnforcement', () => {
  it("returns 'ok' when policy is not enforced", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: false,
      gracePeriodDays: 7,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: null,
      now: 1_000_000,
    });
    expect(result.decision).toBe('ok');
    expect(result.graceDeadline).toBeNull();
    expect(result.graceUntilToSet).toBeNull();
  });

  it("returns 'ok' when user already has 2FA enabled", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: true,
      twoFactorGraceUntil: null,
      now: 1_000_000,
    });
    expect(result.decision).toBe('ok');
  });

  it("returns 'ok' for SSO-only users when policy exempts them", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({ accountProviders: ['microsoft'] });
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: null,
      now: 1_000_000,
    });
    expect(result.decision).toBe('ok');
  });

  it("returns 'blocked' for credential user when grace=0 and no anchor", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: null,
      now: 1_000_000,
    });
    expect(result.decision).toBe('blocked');
    expect(result.graceUntilToSet).toBeNull();
  });

  it('regression #1616: existing anchor + tightened policy → blocked immediately', async () => {
    // User signed in once under grace=7 → anchor was set to now+7d.
    // Admin then changes the policy to grace=0. The user's next sign-in
    // (or next dashboard navigation) must report 'blocked', not 'grace'.
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 0,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const now = 1_000_000;
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: now + 6 * DAY_MS,
      now,
    });
    expect(result.decision).toBe('blocked');
  });

  it('returns capped deadline when stored anchor > current policy window', async () => {
    // Stored anchor = now+7d, policy now = 1d → effective deadline = now+1d.
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 1,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const now = 1_000_000;
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: now + 7 * DAY_MS,
      now,
    });
    expect(result.decision).toBe('grace');
    expect(result.graceDeadline).toBe(now + 1 * DAY_MS);
    // Don't overwrite the stored anchor when capping — it stays as-is.
    expect(result.graceUntilToSet).toBeNull();
  });

  it('preserves shorter stored anchor when admin loosens policy', async () => {
    // Stored anchor = now+1d, policy now = 30d → keep the shorter deadline.
    // Loosening must not extend a user's window.
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 30,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const now = 1_000_000;
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: now + 1 * DAY_MS,
      now,
    });
    expect(result.decision).toBe('grace');
    expect(result.graceDeadline).toBe(now + 1 * DAY_MS);
  });

  it("returns 'grace' with anchor proposal on first encounter under enforcement", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 7,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const now = 1_000_000;
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: null,
      now,
    });
    expect(result.decision).toBe('grace');
    expect(result.graceUntilToSet).toBe(now + 7 * DAY_MS);
    expect(result.graceDeadline).toBe(now + 7 * DAY_MS);
  });

  it("returns 'blocked' when stored anchor has elapsed", async () => {
    mockGetTwoFactorPolicy.mockResolvedValue({
      enforced: true,
      gracePeriodDays: 7,
      exemptSsoUsers: true,
    });
    const ctx = createCtx({});
    const now = 10_000_000;
    const result = await evaluateTwoFactorEnforcement(ctx as never, {
      userId: 'u1',
      twoFactorEnabled: false,
      twoFactorGraceUntil: now - 1, // anchor already in the past
      now,
    });
    expect(result.decision).toBe('blocked');
  });
});
