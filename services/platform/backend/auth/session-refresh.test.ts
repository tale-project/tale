// @vitest-environment node

/**
 * The expiry the session hooks write at a sign-in or refresh (#5164): four
 * minutes short of Better Auth's when an idle window covers the user, so
 * the session refreshes every minute, and Better Auth's own otherwise, so it
 * refreshes every five. The idle sweep reads which kind a row is from that
 * expiry (`domains/governance/session-idle.test.ts`).
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrganizationMember } from './membership.ts';

const policies = vi.hoisted(
  () =>
    new Map<string, { enabled: boolean; idleTimeoutMinutes: number } | Error>(),
);
const members = vi.hoisted(() => new Map<string, OrganizationMember[]>());

vi.mock('../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn((_sql: unknown, organizationId: string) => {
    const policy = policies.get(organizationId);
    return policy instanceof Error
      ? Promise.reject(policy)
      : Promise.resolve(policy ?? null);
  }),
}));
vi.mock('./membership.ts', () => ({
  readUserMemberRows: vi.fn((_sql: unknown, userId: string) =>
    Promise.resolve(members.get(userId) ?? []),
  ),
}));
vi.mock('./request-cache.ts', () => ({
  authRequestCache: vi.fn(() => null),
}));

import { sessionIdleWindowSeconds } from '@tale/shared/utils/session-idle';

import { readUserMemberRows } from './membership.ts';
import { authRequestCache } from './request-cache.ts';
import { sessionExpiryToWrite } from './session-refresh.ts';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Better Auth's expiry for a sign-in or refresh at `NOW`, variable unset. */
const BETTER_AUTH_EXPIRY = new Date(NOW + 7 * DAY);

// Only handed through to the mocked readers.
const sql = {} as Sql;

function member(
  userId: string,
  organizationId: string,
  role = 'member',
): OrganizationMember {
  return { id: `${organizationId}:${userId}`, organizationId, userId, role };
}

function write(userId: string | null, expiresAt = BETTER_AUTH_EXPIRY) {
  return sessionExpiryToWrite(sql, { userId, expiresAt, now: NOW });
}

/** When Better Auth refreshes a session that expires at `expiresAt`. */
function refreshDue(expiresAt: Date): Date {
  const { expiresIn, updateAge } = sessionIdleWindowSeconds();
  return new Date(expiresAt.getTime() - (expiresIn - updateAge) * 1000);
}

beforeEach(() => {
  policies.clear();
  members.clear();
  vi.mocked(authRequestCache).mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('sessionExpiryToWrite (#5164)', () => {
  it('writes four minutes short when a window covers the user: the session refreshes a minute on', async () => {
    policies.set('o1', { enabled: true, idleTimeoutMinutes: 30 });
    members.set('u1', [member('u1', 'o-open'), member('u1', 'o1')]);
    const written = await write('u1');
    expect(written).toEqual(new Date(NOW + 7 * DAY - 4 * MINUTE));
    expect(refreshDue(written)).toEqual(new Date(NOW + MINUTE));
  });

  it("writes Better Auth's expiry when no window covers the user: the session refreshes five minutes on", async () => {
    policies.set('o-off', { enabled: false, idleTimeoutMinutes: 30 });
    policies.set('o-on', { enabled: true, idleTimeoutMinutes: 30 });
    members.set('u1', [
      member('u1', 'o-open'),
      member('u1', 'o-off'),
      // Disabled where the window is: it does not cover them.
      member('u1', 'o-on', 'Disabled'),
    ]);
    expect(await write('u1')).toEqual(BETTER_AUTH_EXPIRY);
    expect(refreshDue(BETTER_AUTH_EXPIRY)).toEqual(new Date(NOW + 5 * MINUTE));
    // Not a member anywhere.
    expect(await write('u2')).toEqual(BETTER_AUTH_EXPIRY);
  });

  it('refreshes every minute, as before #5164, when it cannot tell', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unavailable = new Error('policy store unavailable');
    policies.set('o1', unavailable);
    members.set('u1', [member('u1', 'o1')]);
    const oneMinute = new Date(NOW + 7 * DAY - 4 * MINUTE);
    expect(await write('u1')).toEqual(oneMinute);
    expect(warn).toHaveBeenCalledWith(
      '[session-refresh] idle window check failed: refreshing the session every minute',
      unavailable,
    );
    expect(await write(null)).toEqual(oneMinute);
    expect(warn).toHaveBeenCalledWith(
      '[session-refresh] a session write names no user: refreshing it every minute',
    );
  });

  it('leaves a shorter lifetime as it is: a "don\'t remember me" sign-in is never refreshed', async () => {
    policies.set('o1', { enabled: true, idleTimeoutMinutes: 30 });
    members.set('u1', [member('u1', 'o1')]);
    const oneDay = new Date(NOW + DAY);
    expect(await write('u1', oneDay)).toEqual(oneDay);
    expect(readUserMemberRows).not.toHaveBeenCalled();
  });

  it("with the variable set, writes Better Auth's expiry: every session refreshes every minute already", async () => {
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10');
    policies.set('o1', { enabled: true, idleTimeoutMinutes: 5 });
    members.set('u1', [member('u1', 'o1')]);
    const tenMinutes = new Date(NOW + 10 * MINUTE);
    expect(await write('u1', tenMinutes)).toEqual(tenMinutes);
    expect(refreshDue(tenMinutes)).toEqual(new Date(NOW + MINUTE));
    expect(readUserMemberRows).not.toHaveBeenCalled();
  });

  it("reads the user's member rows through the process's cache where one runs", async () => {
    policies.set('o1', { enabled: true, idleTimeoutMinutes: 30 });
    const memberships = vi.fn(() => Promise.resolve([member('u1', 'o1')]));
    vi.mocked(authRequestCache).mockReturnValue({
      session: vi.fn(),
      memberships,
      poll: vi.fn(),
      stats: vi.fn(),
      stop: vi.fn(),
    });
    expect(await write('u1')).toEqual(new Date(NOW + 7 * DAY - 4 * MINUTE));
    expect(memberships).toHaveBeenCalledWith('u1', expect.any(Function));
    expect(readUserMemberRows).not.toHaveBeenCalled();
  });
});
