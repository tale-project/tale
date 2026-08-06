// Unit gate for the workspace-file resolver — the security boundary
// (canAccessThread) and owner/status resolution that both the list action and
// the download httpAction share. Mocks the generated query factory + the
// canAccessThread/getAuthUserIdentity helpers so the handlers are callable with
// a hand-built ctx (convexTest can't register the betterAuth component the RLS
// path touches — see reference_convextest_components).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

const canAccessThread = vi.fn();
const getAuthUserIdentity = vi.fn();

vi.mock('../lib/rls/auth/can_access_thread', () => ({
  canAccessThread: (...args: unknown[]) => canAccessThread(...args),
}));
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => getAuthUserIdentity(...args),
}));

import { userOwnerId } from './session_naming';
import {
  resolveBrowsableSession,
  resolveBrowsableSessionForUser,
} from './workspace_files';

interface QueryHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

interface SessionRow {
  ownerType: string;
  ownerId: string;
  sessionId: string;
  status: string;
}

function asyncIter<T>(rows: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const r of rows) yield r;
    },
  };
}

/** Mock ctx whose by_owner scan yields rows matching (ownerType, ownerId). */
function createMockCtx(rows: SessionRow[]) {
  function makeBuilder() {
    let ownerType: string | undefined;
    let ownerId: string | undefined;
    const builder: Record<string | symbol, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          if (field === 'ownerType') ownerType = value as string;
          if (field === 'ownerId') ownerId = value as string;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder[Symbol.asyncIterator] = function () {
      return asyncIter(
        rows.filter((r) => r.ownerType === ownerType && r.ownerId === ownerId),
      )[Symbol.asyncIterator]();
    };
    return builder;
  }
  return { db: { query: vi.fn(() => makeBuilder()) }, auth: {} };
}

const forUser = resolveBrowsableSessionForUser as unknown as QueryHandler<
  { threadId: string; userId: string; email?: string },
  { sessionId: string | null; status: string | null; organizationId: string }
>;
const forViewer = resolveBrowsableSession as unknown as QueryHandler<
  { threadId: string },
  { sessionId: string | null; status: string | null; organizationId: string }
>;

const ORG = 'org-1';
const USER = 'user-1';
const THREAD = 'thread-abc';

beforeEach(() => {
  canAccessThread.mockReset();
  getAuthUserIdentity.mockReset();
});

describe('resolveBrowsableSessionForUser (the security boundary)', () => {
  it('throws when canAccessThread denies (cross-org / missing thread)', async () => {
    canAccessThread.mockResolvedValue(null);
    const ctx = createMockCtx([]);
    await expect(
      forUser.handler(ctx, { threadId: THREAD, userId: 'attacker' }),
    ).rejects.toThrow(/not authorized/i);
  });

  it('resolves the per-(org,user) owner key and returns the active session', async () => {
    canAccessThread.mockResolvedValue({
      organizationId: ORG,
      userId: USER,
    });
    const ownerId = userOwnerId(ORG, USER);
    const ctx = createMockCtx([
      { ownerType: 'user', ownerId, sessionId: 'sess-x', status: 'active' },
    ]);
    const res = await forUser.handler(ctx, { threadId: THREAD, userId: USER });
    expect(res).toEqual({
      sessionId: 'sess-x',
      status: 'active',
      organizationId: ORG,
    });
  });

  it('surfaces a degraded session (not just active)', async () => {
    canAccessThread.mockResolvedValue({ organizationId: ORG, userId: USER });
    const ownerId = userOwnerId(ORG, USER);
    const ctx = createMockCtx([
      { ownerType: 'user', ownerId, sessionId: 'sess-d', status: 'degraded' },
    ]);
    const res = await forUser.handler(ctx, { threadId: THREAD, userId: USER });
    expect(res.status).toBe('degraded');
    expect(res.sessionId).toBe('sess-d');
  });

  it('skips terminal incarnations (destroyed) and reports no session', async () => {
    canAccessThread.mockResolvedValue({ organizationId: ORG, userId: USER });
    const ownerId = userOwnerId(ORG, USER);
    const ctx = createMockCtx([
      { ownerType: 'user', ownerId, sessionId: 'old', status: 'destroyed' },
    ]);
    const res = await forUser.handler(ctx, { threadId: THREAD, userId: USER });
    expect(res).toEqual({
      sessionId: null,
      status: null,
      organizationId: ORG,
    });
  });

  it('falls back to the thread-owned key when there is no org/user', async () => {
    // No organizationId on the thread → thread-owned fallback (ownerId = threadId).
    canAccessThread.mockResolvedValue({ organizationId: undefined });
    const ctx = createMockCtx([
      {
        ownerType: 'thread',
        ownerId: THREAD,
        sessionId: 'sess-t',
        status: 'active',
      },
    ]);
    const res = await forUser.handler(ctx, { threadId: THREAD, userId: USER });
    expect(res).toEqual({
      sessionId: 'sess-t',
      status: 'active',
      organizationId: '',
    });
  });
});

describe('resolveBrowsableSession (JWT-cookie path)', () => {
  it('throws when unauthenticated', async () => {
    getAuthUserIdentity.mockResolvedValue(null);
    const ctx = createMockCtx([]);
    await expect(forViewer.handler(ctx, { threadId: THREAD })).rejects.toThrow(
      /not authorized/i,
    );
  });

  it('runs the same boundary once authenticated', async () => {
    getAuthUserIdentity.mockResolvedValue({ userId: USER });
    canAccessThread.mockResolvedValue({ organizationId: ORG, userId: USER });
    const ownerId = userOwnerId(ORG, USER);
    const ctx = createMockCtx([
      { ownerType: 'user', ownerId, sessionId: 'sess-v', status: 'active' },
    ]);
    const res = await forViewer.handler(ctx, { threadId: THREAD });
    expect(res.sessionId).toBe('sess-v');
  });
});
