// @vitest-environment node
import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listMyNotifications } from '../domains/collab/service';
import { listNotifications } from '../domains/notifications/service';
import type { RestEnv } from './shared';
import { createNotificationRestRoutes } from './v1-notifications';

vi.mock('../domains/collab/service', () => ({ listMyNotifications: vi.fn() }));
vi.mock('../domains/notifications/service', () => ({
  listNotifications: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

/** One row of the competence register, as the stand-in below stores it. */
interface Grant {
  orgId: string;
  userId: string;
  competence: string;
  expiresAt: number | null;
  revokedAt: number | null;
}

function fixture(
  role = 'admin',
  recipients = [
    { id: 'person', role: 'member', metadata: { defaultLocale: 'en' } },
  ],
  grants: Grant[] = [],
) {
  // The register read answers the way its WHERE does — the bound
  // organization and slug, unrevoked rows live at the time of asking, held
  // by the member (the `vouchesForUser` fragment, which names them for their
  // own grant and their team's); every other read is the recipient lookup.
  const reads = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!strings.join('?').includes('app.competence_records'))
      return Promise.resolve(recipients);
    const [orgId, competence, now, holder] = values as [
      string,
      string,
      number,
      { fragment: unknown[] },
    ];
    const [userId] = holder.fragment;
    return Promise.resolve(
      grants
        .filter(
          (row) =>
            row.orgId === orgId &&
            row.userId === userId &&
            row.competence === competence &&
            row.revokedAt === null &&
            (row.expiresAt === null || row.expiresAt > now),
        )
        .map(({ expiresAt, revokedAt }) => ({ expiresAt, revokedAt })),
    );
  });
  // A parenthesised fragment nests in the statement that reads it: no read.
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings[0]?.trimStart().startsWith('(')
      ? { fragment: values }
      : reads(strings, ...values);
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('role', role);
    c.set('organizationId', 'org');
    c.set('userId', 'service-user');
    return next();
  });
  app.route('/', createNotificationRestRoutes({ sql: sql as unknown as Sql }));
  const get = (query = '') =>
    app.request(
      `/notifications/sync?recipientEmail=office%40example.test&stream=personal${query}`,
    );
  return { app, sql, reads, get };
}

const personal = {
  id: 'question',
  type: 'agent_question_asked',
  titleKey: 'agentQuestionAsked',
  bodyKey: 'agentQuestionAskedBody',
  params: {
    name: 'Desk',
    title: 'Return',
    question: 'Which period?',
    projectId: 'project/one',
  },
  taskId: 'task one',
  resourceType: 'task',
  resourceId: 'task one',
  actorType: 'agent',
  actorId: null,
  read: false,
  createdAt: 1700000000000,
};

const EXPORT_CAPABILITY = 'tale:notifications.export';

/** A live grant of the export capability to the calling service user. */
function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    orgId: 'org',
    userId: 'service-user',
    competence: EXPORT_CAPABILITY,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('read-only native notification export', () => {
  it('refuses a caller without the role or the capability before reading any member data [NOTIF-R4]', async () => {
    for (const role of ['member', 'editor', 'developer']) {
      const { reads, get } = fixture(role);
      const response = await get();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'ROLE_FORBIDDEN',
        error: expect.stringContaining(EXPORT_CAPABILITY),
      });
      // The one read is the caller's grant in this organization, their own
      // or their team's — never a user or member row.
      expect(reads).toHaveBeenCalledTimes(1);
      const [strings, ...values] = reads.mock.calls[0];
      expect(strings.join('?')).toContain('FROM app.competence_records');
      expect(values).toEqual([
        'org',
        EXPORT_CAPABILITY,
        expect.any(Number),
        { fragment: ['service-user', 'service-user'] },
      ]);
    }
    expect(listMyNotifications).not.toHaveBeenCalled();
    expect(listNotifications).not.toHaveBeenCalled();
  });
  it('never exports for a disabled seat, whatever it holds, and reads nothing [NOTIF-R4]', async () => {
    const { reads, get } = fixture('disabled', undefined, [grant()]);
    expect((await get()).status).toBe(403);
    expect(reads).not.toHaveBeenCalled();
  });
  it('exports for a member an admin granted the capability, with or without an expiry [NOTIF-R4]', async () => {
    vi.mocked(listMyNotifications).mockResolvedValue({
      rows: [personal],
      nextCursor: null,
    });
    for (const live of [
      grant(),
      grant({ expiresAt: Date.now() + 3_600_000 }),
    ]) {
      const { reads, get } = fixture('developer', undefined, [live]);
      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        recipientId: 'person',
        page: [{ id: 'org:personal:question' }],
      });
      // The grant is read first; the recipient is then scoped as for an admin.
      expect(reads.mock.calls[1][0].join(' ')).toContain(
        'u."emailVerified" = true',
      );
    }
    expect(listMyNotifications).toHaveBeenCalledTimes(2);
  });
  it('refuses an expired grant, a revoked one, and grants held elsewhere [NOTIF-R4]', async () => {
    for (const held of [
      grant({ expiresAt: Date.now() - 1 }),
      grant({ revokedAt: Date.now() - 60_000 }),
      grant({ orgId: 'other-org' }),
      grant({ userId: 'another-member' }),
    ]) {
      const { reads, get } = fixture('developer', undefined, [held]);
      expect((await get()).status).toBe(403);
      expect(reads).toHaveBeenCalledTimes(1);
    }
    expect(listMyNotifications).not.toHaveBeenCalled();
    expect(listNotifications).not.toHaveBeenCalled();
  });
  it('exports personal questions with the bell route and bounded recipient-scoped pages', async () => {
    vi.mocked(listMyNotifications).mockResolvedValue({
      rows: [personal],
      nextCursor: 42,
    });
    const { get, sql, reads } = fixture();
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      recipientId: 'person',
      isDone: false,
      page: [
        {
          id: 'org:personal:question',
          title: 'Agent needs your answer',
          body: 'Desk paused with a question on "Return": Which period?',
          path: '/dashboard/org/projects/project%2Fone/tasks?task=task+one',
          read: false,
        },
      ],
    });
    expect(body.page[0].version).toMatch(/^[a-f0-9]{64}$/);
    expect(listMyNotifications).toHaveBeenCalledWith(sql, {
      organizationId: 'org',
      userId: 'person',
      limit: 100,
    });
    expect(reads.mock.calls[0][0].join(' ')).toContain(
      'u."emailVerified" = true',
    );
    expect(reads.mock.calls[0][0].join(' ')).toContain('m."organizationId"');
    expect((await get(`&cursor=${body.continueCursor}`)).status).toBe(200);
    expect(listMyNotifications).toHaveBeenLastCalledWith(
      sql,
      expect.objectContaining({ cursor: 42 }),
    );
  });

  // The run is where the question is answered; the project the row also
  // names has no answer card.
  it('exports a question on a project run with no task with the run as its path [NOTIF-R3]', async () => {
    vi.mocked(listMyNotifications).mockResolvedValue({
      rows: [
        {
          ...personal,
          type: 'agent_escalation',
          bodyKey: 'agentQuestionAskedNoTaskBody',
          params: {
            name: 'billing/dunning-reminder',
            question: 'Which period?',
            askId: 'ask_1',
            runId: 'run_1',
            projectId: 'project/one',
          },
          taskId: null,
          resourceType: 'dashboard',
          resourceId: 'project/one',
        },
      ],
      nextCursor: null,
    });
    const { get } = fixture();
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      page: [
        {
          id: 'org:personal:question',
          body: 'billing/dunning-reminder paused with a question: Which period?',
          path: '/dashboard/org/automations/billing__dunning-reminder/runs/run_1',
        },
      ],
    });
  });
  it('uses the recipient role for organization/security visibility and links to the right audit row [NOTIF-R5]', async () => {
    vi.mocked(listNotifications).mockResolvedValue({
      items: [
        {
          id: 'event',
          organizationId: 'org',
          category: 'security',
          severity: 'warning',
          titleKey: 'notifications.auditIntegrityFailed',
          bodyKey: 'auditIntegrityFailedDetails',
          params: { reason: 'Missing row' },
          link: { kind: 'audit-logs', logId: 'audit/one' },
          createdAt: 12,
          read: true,
        },
      ],
      nextCursor: null,
    });
    const { app, sql } = fixture();
    const response = await app.request(
      '/notifications/sync?recipientEmail=office%40example.test&stream=organization',
    );
    expect(response.status).toBe(200);
    expect(listNotifications).toHaveBeenCalledWith(
      sql,
      { orgId: 'org', userId: 'person', role: 'member' },
      { cursor: null, limit: 100 },
    );
    expect(await response.json()).toMatchObject({
      page: [
        {
          id: 'org:organization:event',
          path: '/dashboard/org/settings/governance/logs?logId=audit%2Fone',
          read: true,
        },
      ],
    });
  });
  it('exports nothing for absent or ambiguous verified memberships [NOTIF-R5]', async () => {
    for (const recipients of [
      [],
      [
        { id: 'one', role: 'member', metadata: { defaultLocale: 'en' } },
        { id: 'two', role: 'member', metadata: { defaultLocale: 'en' } },
      ],
    ]) {
      const { get } = fixture('admin', recipients);
      expect(await (await get()).json()).toEqual({
        recipientId: null,
        page: [],
        isDone: true,
        continueCursor: '',
      });
    }
    expect(listMyNotifications).not.toHaveBeenCalled();
  });
  it('rejects invalid cursors and unknown query parameters', async () => {
    const { get } = fixture();
    for (const query of [
      '&cursor=forged',
      '&cursor=',
      '&limit=1.5',
      '&other=true',
    ])
      expect((await get(query)).status).toBe(400);
    expect(listMyNotifications).not.toHaveBeenCalled();
  });
  it('changes the source version on an update, and renders non-actionable messages in the organization language', async () => {
    const { get } = fixture('owner', [
      { id: 'person', role: 'admin', metadata: { defaultLocale: 'de' } },
    ]);
    vi.mocked(listMyNotifications).mockResolvedValue({
      rows: [
        {
          ...personal,
          titleKey: 'taskCommented',
          bodyKey: 'taskCommentedBody',
        },
      ],
      nextCursor: null,
    });
    const before = await (await get()).json();
    expect(before.page[0].title).not.toBe('taskCommented');
    vi.mocked(listMyNotifications).mockResolvedValue({
      rows: [{ ...personal, read: true }],
      nextCursor: null,
    });
    const after = await (await get()).json();
    expect(after.page[0].version).not.toBe(before.page[0].version);
  });
});
