import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import type { OrgEnv } from '../../auth/org.ts';
import { appErrorHandler } from '../../error-reporting.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { RATE_LIMITS } from '../../lib/rate-limit.ts';
import { createVideoLinkRoutes } from './routes.ts';

vi.mock('../two_factor/service.ts', () => ({
  evaluateTwoFactorEnforcement: vi.fn(async () => ({ decision: 'allowed' })),
}));
vi.mock('../sandbox/retirement-schedule.ts', () => ({
  scheduleMemberWorkspaceRetirement: vi.fn(),
}));
vi.mock('../../core/video_links/ingest_video_link.ts', () => ({
  ingestVideoLinkImpl: vi.fn(),
}));
vi.mock('../chat/shim.ts', () => ({ chatShimHandlers: {} }));
vi.mock('../browser_sessions/service.ts', () => ({
  claimBrowserSession: vi.fn(),
  reportBrowserSessionResult: vi.fn(),
}));
vi.mock('../files/service.ts', () => ({
  deleteOrgBlobRefs: vi.fn(),
  deleteUnheldOrgBlobRefs: vi.fn(),
  putOrgBlobBytes: vi.fn(),
}));
vi.mock('../knowledge/service.ts', () => ({ markRagQueued: vi.fn() }));
vi.mock('../governance/budget-gate.ts', () => ({
  budgetPolicyActive: vi.fn(async () => false),
  loadBudgetSubject: vi.fn(async () => ({ organizationId: 'org-video' })),
}));
vi.mock('../tts/service.ts', () => ({
  checkTtsBudget: vi.fn(async () => ({ allowed: true })),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(async () => 'queue-job'),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('./hints.ts', () => ({ hintVideoJobs: vi.fn() }));

const organizationId = 'org-video';
const userId = 'user-video';
const threadId = 'thread-video';
const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const windowStart = Date.UTC(2026, 9, 4, 0, 0, 0);

function fixture(
  options: {
    exhausted?: boolean;
    disabled?: boolean;
    foreignThread?: boolean;
    limiterFault?: boolean;
  } = {},
) {
  const charges: unknown[][] = [];
  const inserts: unknown[][] = [];
  const query = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      if (text.includes('FROM "member"')) {
        expect(text).toContain('WHERE "userId" = ?');
        expect(values).toEqual([userId]);
        return [
          {
            id: 'member-video',
            organizationId,
            userId,
            role: options.disabled ? 'disabled' : 'member',
          },
        ];
      }
      if (text.includes('FROM app.threads')) {
        expect(values).toEqual([threadId, organizationId, userId]);
        return options.foreignThread ? [] : [{ id: threadId }];
      }
      if (text.includes('FROM app.thread_metadata')) {
        expect(values).toEqual([threadId, organizationId]);
        return [{ projectId: null }];
      }
      if (text.includes('INSERT INTO app.rate_limits')) {
        charges.push(values);
        expect(RATE_LIMITS['file:upload']).toEqual({
          kind: 'fixed window',
          rate: 50,
          period: 60_000,
        });
        expect(values).toEqual([
          'file:upload',
          `org:${organizationId}`,
          1,
          windowStart,
          windowStart,
          1,
          1,
          windowStart,
          windowStart,
          1,
          50,
        ]);
        if (options.limiterFault) throw new Error('synthetic SQL fault');
        return options.exhausted ? [] : [{ value: '1' }];
      }
      if (text.includes('pg_advisory_xact_lock')) return [];
      if (text.includes('SELECT count(*)::text AS count'))
        return [{ count: '0' }];
      if (text.includes('SELECT') && text.includes('FROM app.video_link_jobs'))
        return [];
      if (text.includes('INSERT INTO app.video_link_jobs')) {
        inserts.push(values);
        expect(values.slice(0, 5)).toEqual([
          organizationId,
          threadId,
          null,
          userId,
          url,
        ]);
        return [{ id: 'video-job' }];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  );
  const sql = Object.assign(query, {
    unsafe: (text: string) => text,
    begin: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(sql),
  }) as unknown as Sql;
  const auth = {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: userId, email: 'video@example.test', name: 'Video User' },
        session: { id: 'session-video' },
      })),
    },
  } as unknown as Auth;
  const app = new Hono<OrgEnv>();
  app.onError(appErrorHandler);
  app.route('/api/app/video-links', createVideoLinkRoutes({ sql, auth }));
  const request = (body: unknown = { url, pastedToken: url, threadId }) =>
    app.request(`/api/app/video-links/ingest?orgId=${organizationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { request, charges, inserts };
}

describe('video ingest upload allowance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(windowStart + 12_000);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network forbidden in route fixture');
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps a real exhausted fixed-window refusal to 429 with retry guidance and no work', async () => {
    const { request, charges, inserts } = fixture({ exhausted: true });
    const response = await request();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('48');
    expect(await response.json()).toEqual({
      error: 'RATE_LIMITED',
      code: 'RATE_LIMITED',
      data: { retryAfterMs: 48_000 },
    });
    expect(charges).toHaveLength(1);
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('accepts a normal request through the real service and queues one video job', async () => {
    const { request, charges, inserts } = fixture();
    const response = await request();
    expect(console.error).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: 'video-job' });
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(charges).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'video.ingest',
      { jobId: 'video-job' },
    );
  });

  it('keeps playlist input a domain 400', async () => {
    const { request, charges, inserts } = fixture();
    const playlist = 'https://www.youtube.com/playlist?list=PLfixture';
    const response = await request({
      url: playlist,
      pastedToken: playlist,
      threadId,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'playlist',
      message:
        'Playlist URLs are not supported — paste a single video link instead',
    });
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(charges).toHaveLength(1);
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('rejects disabled members before charging the exhausted allowance', async () => {
    const { request, charges, inserts } = fixture({
      exhausted: true,
      disabled: true,
    });
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'ORG_FORBIDDEN' });
    expect(charges).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('hides a foreign thread before charging the exhausted allowance', async () => {
    const { request, charges, inserts } = fixture({
      exhausted: true,
      foreignThread: true,
    });
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'threadNotFound' });
    expect(charges).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('rejects invalid bodies before charging the exhausted allowance', async () => {
    const { request, charges, inserts } = fixture({ exhausted: true });
    const response = await request({ url });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid body' });
    expect(charges).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does not disguise an unexpected limiter fault as a temporary refusal', async () => {
    const { request, inserts } = fixture({ limiterFault: true });
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(response.headers.get('Retry-After')).toBeNull();
    expect(inserts).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
