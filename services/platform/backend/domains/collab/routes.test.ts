// @vitest-environment node

/**
 * GET /collab/notifications takes its `cursor` (a `seq`, bigint) and `limit`
 * from the query string. They used to ride into the SQL as `Number(raw)`:
 * `?cursor=abc` became NaN, postgres.js serialised it as 'NaN', Postgres
 * refused the bigint and the bell answered 500. A malformed page key is the
 * caller's mistake — this pins the 400 at the boundary and the coerced
 * integers the service receives for a well-formed request.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  listMyNotifications: vi.fn(),
  setNotificationPreferences: vi.fn(),
}));

vi.mock('./service.ts', () => ({
  getNotificationPreferences: vi.fn(),
  getTaskSubscription: vi.fn(),
  listMyNotifications: service.listMyNotifications,
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  myUnreadCount: vi.fn(),
  setNotificationPreferences: service.setNotificationPreferences,
  setTaskSubscription: vi.fn(),
  getMyAttentionSummary: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(),
  loadProjectOrThrow: vi.fn(),
  ProjectError: class extends Error {},
}));
vi.mock('../tasks/service.ts', () => ({
  assertTaskReadable: vi.fn(),
  loadTaskOrThrow: vi.fn(),
  TaskError: class extends Error {},
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createCollabRoutes } from './routes.ts';

async function list(query: string): Promise<Response> {
  return await createCollabRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(`/notifications${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  service.listMyNotifications.mockResolvedValue({ rows: [], nextCursor: null });
});

describe('GET /collab/notifications — query validation', () => {
  it('answers 400 for a cursor that is not a positive integer', async () => {
    for (const bad of ['abc', '-1', '0', '1.5', 'NaN', 'Infinity']) {
      const res = await list(`?cursor=${bad}`);
      expect(res.status, `cursor=${bad}`).toBe(400);
    }
    expect(service.listMyNotifications).not.toHaveBeenCalled();
  });

  it('answers 400 for a limit outside 1..100 or not an integer', async () => {
    for (const bad of ['abc', '0', '101', '2.5']) {
      const res = await list(`?limit=${bad}`);
      expect(res.status, `limit=${bad}`).toBe(400);
    }
    expect(service.listMyNotifications).not.toHaveBeenCalled();
  });

  it('hands the service coerced integers for a well-formed request', async () => {
    const res = await list('?cursor=42&limit=10&unread=true');
    expect(res.status).toBe(200);
    expect(service.listMyNotifications).toHaveBeenCalledTimes(1);
    expect(service.listMyNotifications.mock.calls[0]?.[1]).toEqual({
      organizationId: 'o1',
      userId: 'u1',
      cursor: 42,
      limit: 10,
      unreadOnly: true,
    });
  });

  it('passes neither cursor nor limit when the query carries none', async () => {
    const res = await list('');
    expect(res.status).toBe(200);
    expect(service.listMyNotifications.mock.calls[0]?.[1]).toEqual({
      organizationId: 'o1',
      userId: 'u1',
    });
  });
});

describe('POST /collab/preferences — the offered toggles only', () => {
  it('drops the retired automation-alerts key instead of persisting a setting nothing reads', async () => {
    // The 0.4 `automation_alerts` group has no emitter in 0.5: the toggle
    // is gone from the settings page and the door no longer takes the key.
    const res = await createCollabRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request('/preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ escalation: false, automationAlerts: false }),
    });
    expect(res.status).toBe(200);
    expect(service.setNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(service.setNotificationPreferences.mock.calls[0]?.[3]).toEqual({
      escalation: false,
    });
  });
});
