// @vitest-environment node

/**
 * Team scope retirement: the rows a team scoped (project, folder and
 * document audiences, conversation queues, sync configs) have no FK to
 * `"team"`, so deleting the team would leave them pointed at a ghost
 * nobody's memberships satisfy. These pin the statements the retirement
 * runs — the audience array trimmed and its mirrors re-derived, the queue
 * reset — the hints it emits, the post-commit corpus re-stamp, the delete
 * preview and the atomic delete that wraps them.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';

const { emitHintInTx, syncRagDocumentScope } = vi.hoisted(() => ({
  emitHintInTx: vi.fn(),
  syncRagDocumentScope: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../knowledge/service.ts', () => ({ syncRagDocumentScope }));

import {
  deleteTeamInTx,
  retireDeletedTeamScopes,
  retireTeamScopes,
  teamDeletionImpact,
} from './service.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  // The column expressions ride `sql.unsafe`; the stand-in binds them as
  // values so a test can see which expression a statement carried.
  tag.unsafe = (text: string) => text;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  const sql = tag as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same tag doubles as the transaction
  return { sql, tx: tag as unknown as TransactionSql, statements };
}

const changed =
  (rows: Partial<Record<string, unknown[]>>) =>
  (statement: Statement): unknown[] | undefined => {
    if (statement.text.startsWith('UPDATE app.projects')) return rows.projects;
    if (statement.text.startsWith('UPDATE app.folders')) return rows.folders;
    if (statement.text.startsWith('UPDATE app.documents')) {
      return rows.documents;
    }
    if (statement.text.startsWith('UPDATE app.conversations')) {
      return rows.conversations;
    }
    if (statement.text.startsWith('UPDATE app.onedrive_sync_configs')) {
      return rows.onedrive;
    }
    if (statement.text.startsWith('UPDATE app.google_drive_sync_configs')) {
      return rows.google;
    }
    return undefined;
  };

const startsWith = (statements: Statement[], prefix: string) =>
  statements.find((s) => s.text.startsWith(prefix));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retireTeamScopes', () => {
  it('drops the team from every audience, re-derives the mirrors, resets queues and sync configs', async () => {
    const { tx, statements } = fakeSql(
      changed({
        projects: [
          { id: 'p-both', nowOrgWide: false },
          { id: 'p-sole', nowOrgWide: true },
        ],
        folders: [{ id: 'f1', nowOrgWide: true }],
        documents: [
          { id: 'd-file', fileRef: 's3:key', nowOrgWide: false },
          { id: 'd-text', fileRef: null, nowOrgWide: true },
        ],
        conversations: [{ id: 'c1' }],
        onedrive: [{ id: 'od1' }],
      }),
    );
    const result = await retireTeamScopes(tx, 'org_1', 'team-gone');

    // Projects: ONE statement over the audience array, the two legacy
    // mirrors derived from the same trimmed array (first team, the rest),
    // matched through the rollout-safe expression so a row the previous
    // image wrote with mirrors only is retired too.
    const projects = startsWith(statements, 'UPDATE app.projects');
    expect(projects?.text).toContain('team_ids = array_remove(?, ?)');
    expect(projects?.text).toContain('team_id = (array_remove(?, ?))[1]');
    expect(projects?.text).toContain(
      'shared_with_team_ids = (array_remove(?, ?))[2:]',
    );
    expect(projects?.text).toContain('WHERE org_id = ? AND ? @> ?::text[]');
    expect(projects?.text).toContain(
      'RETURNING id, cardinality(team_ids) = 0 AS "nowOrgWide"',
    );
    expect(projects?.values).toContain(PROJECT_TEAM_IDS_SQL);
    expect(projects?.values).toContain('org_1');
    expect(projects?.values).toContainEqual(['team-gone']);
    expect(
      statements.filter((s) => s.text.startsWith('UPDATE app.projects')),
    ).toHaveLength(1);

    for (const table of ['app.folders', 'app.documents']) {
      const tagged = startsWith(statements, `UPDATE ${table}`);
      expect(tagged?.text, table).toContain(
        'team_tags = array_remove(team_tags, ?)',
      );
      expect(tagged?.text, table).toContain(
        'team_id = (array_remove(team_tags, ?))[1]',
      );
      expect(tagged?.text, table).toContain(
        'WHERE org_id = ? AND team_tags @> ?::text[]',
      );
      expect(tagged?.text, table).toContain(
        'cardinality(team_tags) = 0 AS "nowOrgWide"',
      );
      expect(tagged?.values, table).toContainEqual(['team-gone']);
    }

    const queue = startsWith(statements, 'UPDATE app.conversations');
    expect(queue?.text).toContain('SET assignee_team_id = NULL');
    expect(queue?.values).toEqual(['org_1', 'team-gone']);

    for (const table of [
      'app.onedrive_sync_configs',
      'app.google_drive_sync_configs',
    ]) {
      const sync = startsWith(statements, `UPDATE ${table}`);
      expect(sync?.text, table).toContain('SET team_id = NULL');
      expect(sync?.text, table).toContain('WHERE org_id = ? AND team_id = ?');
    }

    expect(result).toEqual({
      projectsRetagged: 2,
      foldersRetagged: 1,
      documentsRetagged: 2,
      conversationsUnassigned: 1,
      syncConfigsUnscoped: 1,
      // The rows whose LAST team this was — organization-wide from now on.
      nowOrgWide: { projects: 1, folders: 1, documents: 1 },
      touchedFileDocumentIds: ['d-file'],
    });
    expect(emitHintInTx.mock.calls.map((call) => call[1])).toEqual([
      { orgId: 'org_1', entity: 'project', entityId: null },
      { orgId: 'org_1', entity: 'folder', entityId: null },
      { orgId: 'org_1', entity: 'document', entityId: null },
      { orgId: 'org_1', entity: 'conversation', entityId: null },
    ]);
  });

  it('is silent when the team scoped nothing', async () => {
    const { tx } = fakeSql(() => undefined);
    const result = await retireTeamScopes(tx, 'org_1', 'team-unused');
    expect(result).toEqual({
      projectsRetagged: 0,
      foldersRetagged: 0,
      documentsRetagged: 0,
      conversationsUnassigned: 0,
      syncConfigsUnscoped: 0,
      nowOrgWide: { projects: 0, folders: 0, documents: 0 },
      touchedFileDocumentIds: [],
    });
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});

describe('retireDeletedTeamScopes', () => {
  it('runs the retirement in one transaction and re-stamps the file documents after it', async () => {
    const { sql } = fakeSql(
      changed({
        documents: [
          { id: 'd1', fileRef: 's3:a', nowOrgWide: true },
          { id: 'd2', fileRef: 's3:b', nowOrgWide: false },
        ],
      }),
    );
    const result = await retireDeletedTeamScopes(sql, 'org_1', 'team-gone');
    expect(result.touchedFileDocumentIds).toEqual(['d1', 'd2']);
    expect(syncRagDocumentScope.mock.calls).toEqual([
      [sql, 'org_1', 'd1'],
      [sql, 'org_1', 'd2'],
    ]);
  });
});

describe('teamDeletionImpact', () => {
  it('counts what the delete touches and what becomes organization-wide', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.startsWith('SELECT t."name"')
        ? [
            {
              name: 'Finance',
              memberCount: 3,
              projects: 4,
              projectsSole: 1,
              folders: 2,
              foldersSole: 2,
              documents: 10,
              documentsSole: 7,
              conversations: 5,
              syncConfigs: 1,
            },
          ]
        : undefined,
    );
    const impact = await teamDeletionImpact(sql, 'org_1', 't-fin');
    expect(impact).toEqual({
      teamId: 't-fin',
      name: 'Finance',
      memberCount: 3,
      projects: { scoped: 4, becomeOrgWide: 1 },
      folders: { scoped: 2, becomeOrgWide: 2 },
      documents: { scoped: 10, becomeOrgWide: 7 },
      conversations: { queued: 5 },
      syncConfigs: { scoped: 1 },
    });
    const read = statements[0];
    // "Sole" = the audience IS exactly this team; "scoped" = contains it.
    expect(read?.text).toContain('@> ?::text[]');
    expect(read?.text).toContain('= ?::text[]');
    // Only live documents count — a trashed one is not a visible change.
    expect(read?.text).toContain("d.lifecycle_status = 'active'");
    expect(read?.text).toContain('WHERE t."id" = ? AND t."organizationId" = ?');
    expect(read?.values.slice(-2)).toEqual(['t-fin', 'org_1']);
  });

  it('answers null for a team that is not this organization’s', async () => {
    const { sql } = fakeSql(() => []);
    expect(await teamDeletionImpact(sql, 'org_1', 't-other')).toBeNull();
  });
});

describe('deleteTeamInTx', () => {
  it('retires the scopes, the provenance, the memberships and the row in one transaction', async () => {
    const { tx, statements } = fakeSql((statement) => {
      if (statement.text.startsWith('SELECT "id", "name" FROM "team"')) {
        return [{ id: 't-fin', name: 'Finance' }];
      }
      return changed({ projects: [{ id: 'p1', nowOrgWide: true }] })(statement);
    });

    const deleted = await deleteTeamInTx(tx, 'org_1', 't-fin');

    expect(deleted).toEqual({
      name: 'Finance',
      retirement: expect.objectContaining({
        projectsRetagged: 1,
        nowOrgWide: { projects: 1, folders: 0, documents: 0 },
      }),
    });
    // The row is locked first, so a concurrent member add or a second
    // delete waits on it; then the scopes; then everything that names the
    // team; the team row last.
    const heads = statements.map((s) =>
      s.text.split(' ').slice(0, 3).join(' '),
    );
    expect(heads[0]).toBe('SELECT "id", "name"');
    expect(statements[0]?.text).toContain('FOR UPDATE');
    expect(statements[0]?.values).toEqual(['t-fin', 'org_1']);
    const order = [
      'UPDATE app.projects SET',
      'DELETE FROM app.sso_synced_team_members',
      'DELETE FROM app.sso_synced_teams',
      'DELETE FROM app.sso_provisioning_links',
      'DELETE FROM "teamMember"',
      'DELETE FROM "team"',
    ].map((head) => heads.indexOf(head));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const links = startsWith(
      statements,
      'DELETE FROM app.sso_provisioning_links',
    );
    expect(links?.text).toContain("resource_type = 'Group'");
    expect(startsWith(statements, 'DELETE FROM "team" WHERE')?.values).toEqual([
      't-fin',
    ]);
    // The team hint is the LAST thing in the transaction, after the
    // per-entity scope hints.
    expect(emitHintInTx.mock.calls.at(-1)?.[1]).toEqual({
      orgId: 'org_1',
      entity: TEAM_HINT_ENTITY,
      entityId: 't-fin',
    });
  });

  it('answers null and writes nothing for a team of another organization', async () => {
    const { tx, statements } = fakeSql(() => []);
    expect(await deleteTeamInTx(tx, 'org_1', 't-other')).toBeNull();
    expect(statements).toHaveLength(1);
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});
