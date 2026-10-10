// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTH_INVALIDATION_TRIGGERS } from '../db/auth-invalidation-triggers.ts';
import type { OrganizationMember } from './membership.ts';
import {
  authRequestCache,
  authRequestCacheEnabled,
  authRequestSessionCacheEnabled,
  createAuthRequestCache,
  reclaimAuthInvalidations,
  soleCookieValue,
  startAuthRequestCache,
  stopAuthRequestCache,
} from './request-cache.ts';
import type { SessionBundle } from './session.ts';

/**
 * The per-process auth cache answers a session or a user's memberships from
 * memory only while it has read the invalidation log within the last second
 * and the triggers that feed the log exist; it drops an entry the moment
 * the log names its session or user, never keeps a read that raced such a
 * change, and never files a session under a cookie that does not carry it.
 */

interface LogRow {
  id: string;
  kind: string;
  subjectId: string;
}

const SESSION_CONFIG = { expiresIn: 7 * 24 * 3600, updateAge: 60 };

function fakeDatabase(options: { triggers?: readonly string[] } = {}) {
  const state = {
    triggers: options.triggers ?? [...AUTH_INVALIDATION_TRIGGERS],
    /** Rows the next log read returns (every row at or past the horizon). */
    log: [] as LogRow[],
    horizon: '100',
    failLog: false,
    /** The horizon each log read was asked from. */
    readFrom: [] as (string | null)[],
    deletes: [] as number[],
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM pg_trigger')) {
      return Promise.resolve(state.triggers.map((name) => ({ name })));
    }
    if (text.includes('pg_snapshot_xmin')) {
      if (state.failLog) {
        return Promise.reject(new Error('connection refused'));
      }
      const from = values[0];
      state.readFrom.push(typeof from === 'string' ? from : null);
      const rows =
        from === null
          ? [{ horizon: state.horizon, id: null, kind: null, subjectId: null }]
          : state.log.length === 0
            ? [
                {
                  horizon: state.horizon,
                  id: null,
                  kind: null,
                  subjectId: null,
                },
              ]
            : state.log.map((row) => ({ horizon: state.horizon, ...row }));
      return Promise.resolve(rows);
    }
    if (text.includes('DELETE FROM app_realtime.auth_invalidations')) {
      const count = state.deletes.shift() ?? 0;
      return Promise.resolve(Object.assign([], { count }));
    }
    return Promise.reject(new Error(`unexpected SQL: ${text}`));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
  return { sql: sql as unknown as Sql, state };
}

function bundleOf(
  token: string,
  options: { sessionId?: string; userId?: string; expiresAt: number },
): SessionBundle {
  // A Better Auth bundle carries more than the structural subset names.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the extra fields are read reflectively
  return {
    user: { id: options.userId ?? 'u-1', email: 'a@b.c', name: 'A' },
    session: {
      id: options.sessionId ?? 's-1',
      token,
      expiresAt: new Date(options.expiresAt),
    },
  } as SessionBundle;
}

function clock(start: number) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A session last refreshed at `refreshedAt`, as Better Auth stores it. */
function expiresAfterRefreshAt(refreshedAt: number): number {
  return refreshedAt + SESSION_CONFIG.expiresIn * 1000;
}

function counting<T>(answer: () => T) {
  const calls = { count: 0 };
  return {
    calls,
    resolve: async (): Promise<T> => {
      calls.count += 1;
      return answer();
    },
  };
}

afterEach(async () => {
  await stopAuthRequestCache();
  vi.restoreAllMocks();
});

describe('soleCookieValue', () => {
  it('reads the one cookie of that exact name, raw', () => {
    expect(
      soleCookieValue(
        'theme=dark; better-auth.session_token=tok.sig%3D ; other=1',
        'better-auth.session_token',
      ),
    ).toBe('tok.sig%3D');
  });

  it('answers null when the cookie is absent, empty or sent twice', () => {
    const name = 'better-auth.session_token';
    expect(soleCookieValue(null, name)).toBeNull();
    expect(soleCookieValue('theme=dark', name)).toBeNull();
    expect(soleCookieValue(`${name}=`, name)).toBeNull();
    expect(soleCookieValue(`${name}=a.1; ${name}=b.2`, name)).toBeNull();
    // A secure-prefixed twin is another name, not a second copy.
    expect(soleCookieValue(`__Secure-${name}=a.1; ${name}=b.2`, name)).toBe(
      'b.2',
    );
  });
});

describe('createAuthRequestCache — sessions', () => {
  it('answers nothing from memory before its first read of the log', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    const bundle = bundleOf('tok', {
      expiresAt: expiresAfterRefreshAt(time.now()),
    });
    const source = counting(() => bundle);
    await cache.session('tok.sig', source.resolve);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
    expect(cache.stats().serving).toBe(false);
  });

  it('serves a session it resolved a moment ago, once the log has been read', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const bundle = bundleOf('tok', {
      expiresAt: expiresAfterRefreshAt(time.now()),
    });
    const source = counting(() => bundle);
    expect(await cache.session('tok.sig', source.resolve)).toBe(bundle);
    expect(await cache.session('tok.sig', source.resolve)).toBe(bundle);
    expect(source.calls.count).toBe(1);
    expect(cache.stats()).toMatchObject({ sessionHits: 1, sessionMisses: 1 });
  });

  it('never files a bundle under a cookie that does not carry its token', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const bundle = bundleOf('real', {
      expiresAt: expiresAfterRefreshAt(time.now()),
    });
    const source = counting(() => bundle);
    await cache.session('other.sig', source.resolve);
    await cache.session('other.sig', source.resolve);
    // A token that merely starts the same way is not the same token.
    await cache.session('realx.sig', source.resolve);
    await cache.session('realx.sig', source.resolve);
    expect(source.calls.count).toBe(4);
  });

  it('stops answering when Better Auth would slide the expiry, so the refresh is written', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    await cache.poll();
    // Refreshed 50 s ago: the refresh falls due in 10 s.
    const bundle = bundleOf('tok', {
      expiresAt: expiresAfterRefreshAt(time.now() - 50_000),
    });
    const source = counting(() => bundle);
    await cache.session('tok.sig', source.resolve);
    time.advance(9_000);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(1);
    time.advance(1_000);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
  });

  it('answers one entry for a minute at most, however late the refresh', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: { expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
      now: time.now,
      loop: false,
      staleAfterMs: Number.POSITIVE_INFINITY,
    });
    await cache.poll();
    const bundle = bundleOf('tok', {
      expiresAt: time.now() + 7 * 24 * 3600 * 1000,
    });
    const source = counting(() => bundle);
    await cache.session('tok.sig', source.resolve);
    time.advance(59_999);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(1);
    time.advance(1);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
  });

  it('drops a session the log names, and every session of a user it names', async () => {
    const { sql, state } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const expiresAt = expiresAfterRefreshAt(time.now());
    const first = counting(() =>
      bundleOf('one', { sessionId: 's-1', userId: 'u-1', expiresAt }),
    );
    const second = counting(() =>
      bundleOf('two', { sessionId: 's-2', userId: 'u-1', expiresAt }),
    );
    await cache.session('one.sig', first.resolve);
    await cache.session('two.sig', second.resolve);

    state.log = [{ id: '1', kind: 'session', subjectId: 's-1' }];
    await cache.poll();
    await cache.session('one.sig', first.resolve);
    await cache.session('two.sig', second.resolve);
    expect([first.calls.count, second.calls.count]).toEqual([2, 1]);

    state.log = [{ id: '2', kind: 'user', subjectId: 'u-1' }];
    await cache.poll();
    await cache.session('one.sig', first.resolve);
    await cache.session('two.sig', second.resolve);
    expect([first.calls.count, second.calls.count]).toEqual([3, 2]);
  });

  it('reads every row from the last read’s horizon, and applies a row it saw once only once', async () => {
    const { sql, state } = fakeDatabase();
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      loop: false,
    });
    await cache.poll();
    state.log = [{ id: '7', kind: 'member', subjectId: 'u-1' }];
    state.horizon = '120';
    await cache.poll();
    await cache.poll();
    expect(state.readFrom).toEqual([null, '100', '120']);
    expect(cache.stats().applied).toBe(1);
  });

  it('keeps nothing it read while a change to the same session landed', async () => {
    const { sql, state } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const bundle = bundleOf('tok', {
      expiresAt: expiresAfterRefreshAt(time.now()),
    });
    let reads = 0;
    const racing = async () => {
      reads += 1;
      if (reads === 1) {
        // The revocation commits after this read; the log brings it in
        // before the read returns.
        state.log = [{ id: '1', kind: 'session', subjectId: 's-1' }];
        await cache.poll();
      }
      return bundle;
    };
    await cache.session('tok.sig', racing);
    await cache.session('tok.sig', racing);
    expect(reads).toBe(2);
  });

  it('stops answering a second after its last good read, and logs the outage once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sql, state } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const bundle = bundleOf('tok', {
      expiresAt: expiresAfterRefreshAt(time.now()),
    });
    const source = counting(() => bundle);
    await cache.session('tok.sig', source.resolve);
    state.failLog = true;
    time.advance(500);
    await cache.poll();
    await cache.poll();
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(1);
    time.advance(501);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
    expect(cache.stats().serving).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers nothing while a trigger is missing, and says which', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { sql } = fakeDatabase({ triggers: ['auth_session_deleted'] });
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      loop: false,
    });
    await cache.poll();
    await cache.poll();
    expect(cache.stats().serving).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('auth_member_changed');
  });

  it('forgets everything on a change of a kind it does not know', async () => {
    const { sql, state } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
    });
    await cache.poll();
    const source = counting(() =>
      bundleOf('tok', { expiresAt: expiresAfterRefreshAt(time.now()) }),
    );
    await cache.session('tok.sig', source.resolve);
    state.log = [{ id: '1', kind: 'organization', subjectId: 'o-1' }];
    await cache.poll();
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
  });

  it('leaves sessions to Better Auth when told to, and still keeps memberships', async () => {
    const { sql } = fakeDatabase();
    const time = clock(1_000_000);
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      now: time.now,
      loop: false,
      sessions: false,
    });
    await cache.poll();
    const source = counting(() =>
      bundleOf('tok', { expiresAt: expiresAfterRefreshAt(time.now()) }),
    );
    await cache.session('tok.sig', source.resolve);
    await cache.session('tok.sig', source.resolve);
    expect(source.calls.count).toBe(2);
    const rows = counting((): OrganizationMember[] => []);
    await cache.memberships('u-1', rows.resolve);
    await cache.memberships('u-1', rows.resolve);
    expect(rows.calls.count).toBe(1);
  });
});

describe('createAuthRequestCache — memberships', () => {
  const member: OrganizationMember = {
    id: 'm-1',
    organizationId: 'o-1',
    userId: 'u-1',
    role: 'admin',
  };

  it('serves a user’s rows until the log names the user’s memberships or the user', async () => {
    const { sql, state } = fakeDatabase();
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      loop: false,
    });
    await cache.poll();
    const rows = counting(() => [member]);
    expect(await cache.memberships('u-1', rows.resolve)).toEqual([member]);
    await cache.memberships('u-1', rows.resolve);
    expect(rows.calls.count).toBe(1);

    state.log = [{ id: '1', kind: 'member', subjectId: 'u-1' }];
    await cache.poll();
    await cache.memberships('u-1', rows.resolve);
    expect(rows.calls.count).toBe(2);

    state.log = [{ id: '2', kind: 'user', subjectId: 'u-1' }];
    await cache.poll();
    await cache.memberships('u-1', rows.resolve);
    expect(rows.calls.count).toBe(3);
    expect(cache.stats()).toMatchObject({
      membershipHits: 1,
      membershipMisses: 3,
    });
  });

  it('keeps nothing it read while the user’s memberships changed', async () => {
    const { sql, state } = fakeDatabase();
    const cache = createAuthRequestCache(sql, {
      sessionConfig: SESSION_CONFIG,
      loop: false,
    });
    await cache.poll();
    let reads = 0;
    const racing = async () => {
      reads += 1;
      if (reads === 1) {
        state.log = [{ id: '1', kind: 'member', subjectId: 'u-1' }];
        await cache.poll();
      }
      return [member];
    };
    await cache.memberships('u-1', racing);
    await cache.memberships('u-1', racing);
    expect(reads).toBe(2);
  });
});

describe('the process cache', () => {
  it('is off with AUTH_REQUEST_CACHE=off, and its session half under the signed-cookie cache', async () => {
    const { sql } = fakeDatabase();
    expect(authRequestCacheEnabled({})).toBe(true);
    expect(authRequestCacheEnabled({ AUTH_REQUEST_CACHE: ' OFF ' })).toBe(
      false,
    );
    expect(authRequestSessionCacheEnabled({})).toBe(true);
    expect(
      authRequestSessionCacheEnabled({ SESSION_COOKIE_CACHE_SECONDS: '30' }),
    ).toBe(false);
    expect(
      startAuthRequestCache(
        sql,
        { sessionConfig: SESSION_CONFIG, loop: false },
        { AUTH_REQUEST_CACHE: 'off' },
      ),
    ).toBeNull();
    expect(authRequestCache()).toBeNull();
  });

  it('is installed for the process until stopped', async () => {
    const { sql } = fakeDatabase();
    const cache = startAuthRequestCache(
      sql,
      { sessionConfig: SESSION_CONFIG, loop: false },
      {},
    );
    expect(authRequestCache()).toBe(cache);
    await stopAuthRequestCache();
    expect(authRequestCache()).toBeNull();
  });
});

describe('reclaimAuthInvalidations', () => {
  it('deletes past the retention in batches until a batch comes back short', async () => {
    const { sql, state } = fakeDatabase();
    state.deletes = [5_000, 5_000, 12];
    expect(await reclaimAuthInvalidations(sql, 10_000_000)).toBe(10_012);
    expect(state.deletes).toEqual([]);
  });
});
