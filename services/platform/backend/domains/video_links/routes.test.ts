// @vitest-environment node

/**
 * `POST /video-links/ingest` from a project's new chat: the link is fetched
 * and transcribed before the chat's first message creates its thread, so the
 * composer names the project its cost counts toward. A project named beside
 * no thread must be one the member may chat in; a thread names its own, and
 * a project sent beside one is ignored.
 *
 * `GET /video-links/thread/:threadId` lists a chat's jobs to its owner alone:
 * the chips live in the sender's composer, so a member who reads the chat
 * through its project (CHAT-R2) is answered as for a chat they cannot see.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import { projectChatAccess } from '../chat/threads.ts';
import { createVideoLinkRoutes } from './routes.ts';
import { ingestVideoUrl, listForThread } from './service.ts';

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('sessionBundle', { user: { id: 'user_1' } });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () =>
    async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set('orgId', 'org_1');
      c.set('orgMember', { role: 'member' });
      await next();
    },
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkOrganizationRateLimit: vi.fn(() => Promise.resolve()),
}));
vi.mock('../chat/threads.ts', () => ({
  projectChatAccess: vi.fn(),
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ingestVideoUrl: vi.fn(() => Promise.resolve('job_1')),
  listForThread: vi.fn(() => Promise.resolve([])),
}));

/** Answers the own-thread probe with the thread, as for the caller's own. */
const sql = vi.hoisted(() =>
  Object.assign(() => Promise.resolve([{ id: 'thread_1' }]), {}),
);

function ingest(body: Record<string, unknown>) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the probe tag answers every query; the mocked middleware never touches auth
  return createVideoLinkRoutes({
    sql: sql as unknown as Sql,
    auth: {} as Auth,
  }).request('/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://www.youtube.com/watch?v=abc',
      pastedToken: 'token_1',
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.mocked(projectChatAccess).mockResolvedValue('ok');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /video-links/ingest — a project’s new chat', () => {
  it('hands a project the member may chat in to the job [GOV-R14]', async () => {
    const res = await ingest({ projectId: 'project_1' });

    expect(res.status).toBe(200);
    expect(projectChatAccess).toHaveBeenCalledWith(sql, {
      projectId: 'project_1',
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(ingestVideoUrl).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ projectId: 'project_1' }),
    );
  });

  it.each(['not_found', 'forbidden'] as const)(
    'refuses a project the member cannot chat in (%s), before any job [GOV-R14]',
    async (access) => {
      vi.mocked(projectChatAccess).mockResolvedValue(access);

      const res = await ingest({ projectId: 'project_1' });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'projectUnavailable',
        message: 'Project unavailable',
      });
      expect(ingestVideoUrl).not.toHaveBeenCalled();
    },
  );

  it('lets a thread name its own project, ignoring one sent beside it', async () => {
    const res = await ingest({ threadId: 'thread_1', projectId: 'project_1' });

    expect(res.status).toBe(200);
    expect(projectChatAccess).not.toHaveBeenCalled();
    expect(ingestVideoUrl).toHaveBeenCalledWith(
      sql,
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
  });
});

describe('GET /video-links/thread/:threadId — the owner’s jobs [CHAT-R2]', () => {
  it('lists the jobs of the caller’s own chat', async () => {
    const res = await createVideoLinkRoutes({
      sql: sql as unknown as Sql,
      auth: {} as Auth,
    }).request('/thread/thread_1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [] });
    expect(listForThread).toHaveBeenCalledWith(sql, 'org_1', 'thread_1');
  });

  it('answers 404 to a reader of a chat shared with their project, listing nothing', async () => {
    // Another member's chat, shared with a project the caller may chat in:
    // it exists, yet the probe bound to the caller finds nothing.
    const probes: unknown[][] = [];
    const readerSql = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<unknown[]> => {
      if (!strings.join('?').includes('t.user_id = ?')) {
        return Promise.resolve([{ id: 'thread_shared' }]);
      }
      probes.push(values);
      return Promise.resolve([]);
    };

    const res = await createVideoLinkRoutes({
      sql: readerSql as unknown as Sql,
      auth: {} as Auth,
    }).request('/thread/thread_shared');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'threadNotFound',
      message: 'Thread not found',
    });
    expect(probes).toEqual([['thread_shared', 'org_1', 'user_1']]);
    expect(listForThread).not.toHaveBeenCalled();
  });
});
