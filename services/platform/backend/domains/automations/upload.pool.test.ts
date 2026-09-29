// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { uploadAutomationImpl } from '../../core/automations/upload_impl.ts';
import { auditSkillWrite } from '../skills/audit.ts';
import { maySkillPublishOrgWide } from '../skills/publish.ts';
import { uploadAutomationPg } from './upload.ts';

vi.mock('../../core/automations/upload_impl.ts', () => ({
  uploadAutomationImpl: vi.fn(),
}));
vi.mock('../skills/audit.ts', () => ({
  auditSkillWrite: vi.fn(async () => undefined),
}));
vi.mock('../skills/publish.ts', () => ({
  maySkillPublishOrgWide: vi.fn(async () => false),
}));

/** A one-connection pool: while begin reserves its only connection, a
 * query through the pool cannot run. Fail immediately instead of leaving
 * this regression hanging forever as a real exhausted pool would. */
function oneConnectionPool(): Sql {
  let reserved = false;
  const query = (strings: TemplateStringsArray) => {
    const statement = strings.join('?');
    if (statement.includes('FROM "teamMember"')) {
      return Promise.resolve([{ teamId: 'mine' }]);
    }
    if (statement.includes('FROM "team"')) {
      return Promise.resolve([{ id: 'mine' }, { id: 'other' }]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(
    (strings: TemplateStringsArray) => {
      if (reserved) throw new Error('The only pool connection is reserved');
      return query(strings);
    },
    {
      begin: async (work: (tx: TransactionSql) => Promise<unknown>) => {
        if (reserved) throw new Error('Cannot reserve a second connection');
        reserved = true;
        try {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- query-only transaction double
          return await work(query as unknown as TransactionSql);
        } finally {
          reserved = false;
        }
      },
    },
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one-connection pool double
  return sql as unknown as Sql;
}

describe('package audience reads under the writer lock', () => {
  it.each(['mine', 'other'])(
    'checks %s without reserving a second connection',
    async (team) => {
      vi.mocked(uploadAutomationImpl).mockImplementationOnce(async (host) => {
        await host.getViewerContext();
        await host.withSkillWriterLocks(['triage'], async (writer) => {
          await writer.assertTeamsAssignable([team]);
        });
        return { ok: true, name: 'flow', version: 1, warnings: [], skills: [] };
      });
      const result = uploadAutomationPg(
        oneConnectionPool(),
        {
          organizationId: 'org-1',
          orgSlug: 'acme',
          userId: 'user-1',
          role: 'developer',
        },
        { storageId: 's3:acme/staged.zip' },
      );
      if (team === 'mine') {
        await expect(result).resolves.toMatchObject({ ok: true });
      } else {
        await expect(result).rejects.toMatchObject({
          data: { code: 'TEAM_ACCESS_DENIED' },
        });
      }
    },
  );
});

describe('carried skills in the audit log', () => {
  it('records each installed skill as the uploader, on the connection holding the lock', async () => {
    let lockConnection: unknown;
    const revision = (etag: string) => ({
      meta: {
        name: 'triage',
        description: 'Sorts',
        visibility: 'org' as const,
        extra: {},
      },
      body: 'x\n',
      etag,
    });
    vi.mocked(uploadAutomationImpl).mockImplementationOnce(async (host) => {
      await host.withSkillWriterLocks(['triage'], async (writer) => {
        await writer.recordSkillWrite({
          slug: 'triage',
          previous: revision('"t1"'),
          current: revision('"t2"'),
          filesChanged: true,
        });
      });
      return { ok: true, name: 'flow', version: 1, warnings: [], skills: [] };
    });
    const pool = oneConnectionPool();
    const begin = pool.begin.bind(pool);
    Object.assign(pool, {
      begin: (work: (tx: TransactionSql) => Promise<unknown>) =>
        begin(async (tx: TransactionSql) => {
          lockConnection = tx;
          return work(tx);
        }),
    });

    await uploadAutomationPg(
      pool,
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        userId: 'user-1',
        email: 'dev@example.com',
        role: 'developer',
      },
      { storageId: 's3:acme/staged.zip' },
    );

    expect(auditSkillWrite).toHaveBeenCalledWith(lockConnection, {
      organizationId: 'org-1',
      slug: 'triage',
      actor: { id: 'user-1', email: 'dev@example.com', role: 'developer' },
      via: 'automation_package',
      previous: revision('"t1"'),
      current: revision('"t2"'),
      filesChanged: true,
    });
  });
});

describe('carried skills shared with the whole organization', () => {
  it('asks the skill doors’ publish rule for the uploader, on the pool', async () => {
    let answer: boolean | undefined;
    vi.mocked(uploadAutomationImpl).mockImplementationOnce(async (host) => {
      answer = await host.mayPublishOrgWide();
      return { ok: true, name: 'flow', version: 1, warnings: [], skills: [] };
    });
    const pool = oneConnectionPool();
    await uploadAutomationPg(
      pool,
      {
        organizationId: 'org-1',
        orgSlug: 'acme',
        userId: 'user-1',
        role: 'developer',
      },
      { storageId: 's3:acme/staged.zip' },
    );
    expect(answer).toBe(false);
    expect(maySkillPublishOrgWide).toHaveBeenCalledExactlyOnceWith(pool, {
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'developer',
    });
  });
});
