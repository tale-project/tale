// @vitest-environment node

/**
 * Team scope retirement: the rows a team scoped (projects, folders,
 * documents, conversation queues, sync configs) have no FK to `"team"`, so
 * deleting the team used to leave them pointed at a ghost nobody's
 * memberships satisfy. These pin the statements the retirement runs — the
 * ownership promotion, the tag removal, the queue reset — the hints it
 * emits, the post-commit corpus re-stamp, and the sweep that finds ghosts
 * left by the days before the doors retired scopes.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emitHintInTx, syncRagDocumentScope } = vi.hoisted(() => ({
  emitHintInTx: vi.fn(),
  syncRagDocumentScope: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../knowledge/service.ts', () => ({ syncRagDocumentScope }));

import {
  repairTeamScopes,
  retireDeletedTeamScopes,
  retireTeamScopes,
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  const sql = tag as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same tag doubles as the transaction
  return { sql, tx: tag as unknown as TransactionSql, statements };
}

const changed =
  (rows: Partial<Record<string, unknown[]>>) =>
  (statement: Statement): unknown[] | undefined => {
    if (statement.text.startsWith('UPDATE app.projects SET team_id')) {
      return rows.owned;
    }
    if (statement.text.startsWith('UPDATE app.projects SET shared_with')) {
      return rows.shared;
    }
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retireTeamScopes', () => {
  it('promotes the first shared team on owned projects, removes the team from shared lists, tags and queues', async () => {
    const { tx, statements } = fakeSql(
      changed({
        owned: [{ id: 'p-owned' }],
        shared: [{ id: 'p-shared' }],
        folders: [{ id: 'f1' }],
        documents: [
          { id: 'd-file', fileRef: 's3:key' },
          { id: 'd-text', fileRef: null },
        ],
        conversations: [{ id: 'c1' }],
        onedrive: [{ id: 'od1' }],
      }),
    );
    const result = await retireTeamScopes(tx, 'org_1', 'team-gone');

    const owned = statements.find((s) =>
      s.text.startsWith('UPDATE app.projects SET team_id'),
    );
    expect(owned?.text).toContain('team_id = shared_with_team_ids[1]');
    expect(owned?.text).toContain(
      'shared_with_team_ids = shared_with_team_ids[2:]',
    );
    expect(owned?.text).toContain('WHERE org_id = ? AND team_id = ?');
    expect(owned?.values.slice(1)).toEqual(['org_1', 'team-gone']);

    const shared = statements.find((s) =>
      s.text.startsWith('UPDATE app.projects SET shared_with'),
    );
    expect(shared?.text).toContain('array_remove(shared_with_team_ids, ?)');
    expect(shared?.text).toContain('? = ANY(shared_with_team_ids)');

    for (const table of ['app.folders', 'app.documents']) {
      const tagged = statements.find((s) =>
        s.text.startsWith(`UPDATE ${table}`),
      );
      expect(tagged?.text, table).toContain(
        'team_tags = array_remove(team_tags, ?)',
      );
      expect(tagged?.text, table).toContain(
        'team_id = (array_remove(team_tags, ?))[1]',
      );
      expect(tagged?.text, table).toContain(
        '(team_id = ? OR ? = ANY(team_tags))',
      );
    }

    const queue = statements.find((s) =>
      s.text.startsWith('UPDATE app.conversations'),
    );
    expect(queue?.text).toContain('SET assignee_team_id = NULL');
    expect(queue?.values).toEqual(['org_1', 'team-gone']);

    for (const table of [
      'app.onedrive_sync_configs',
      'app.google_drive_sync_configs',
    ]) {
      const sync = statements.find((s) => s.text.startsWith(`UPDATE ${table}`));
      expect(sync?.text, table).toContain('SET team_id = NULL');
      expect(sync?.text, table).toContain('WHERE org_id = ? AND team_id = ?');
    }

    expect(result).toEqual({
      projectsUnscoped: 1,
      projectsUnshared: 1,
      foldersRetagged: 1,
      documentsRetagged: 2,
      conversationsUnassigned: 1,
      syncConfigsUnscoped: 1,
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
      projectsUnscoped: 0,
      projectsUnshared: 0,
      foldersRetagged: 0,
      documentsRetagged: 0,
      conversationsUnassigned: 0,
      syncConfigsUnscoped: 0,
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
          { id: 'd1', fileRef: 's3:a' },
          { id: 'd2', fileRef: 's3:b' },
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

describe('repairTeamScopes', () => {
  it('finds every (org, team) reference without a team row in that org and retires each', async () => {
    const { sql, statements } = fakeSql((statement) => {
      if (statement.text.startsWith('WITH refs AS')) {
        return [
          { orgId: 'org_1', teamId: 'ghost-a' },
          { orgId: 'org_2', teamId: 'ghost-b' },
        ];
      }
      if (
        statement.text.startsWith('UPDATE app.projects SET team_id') &&
        statement.values.includes('ghost-a')
      ) {
        return [{ id: 'p1' }];
      }
      return undefined;
    });
    const result = await repairTeamScopes(sql);

    const scan = statements[0];
    expect(scan?.text).toContain('FROM app.projects WHERE team_id IS NOT NULL');
    expect(scan?.text).toContain(
      'unnest(shared_with_team_ids) FROM app.projects',
    );
    expect(scan?.text).toContain('unnest(team_tags) FROM app.folders');
    expect(scan?.text).toContain('unnest(team_tags) FROM app.documents');
    expect(scan?.text).toContain('assignee_team_id FROM app.conversations');
    expect(scan?.text).toContain('FROM app.onedrive_sync_configs');
    expect(scan?.text).toContain('FROM app.google_drive_sync_configs');
    // A team that exists in ANOTHER org is a ghost for this one.
    expect(scan?.text).toContain(
      'WHERE t."id" = refs.team_id AND t."organizationId" = refs.org_id',
    );

    expect(result.ghosts).toEqual([
      { orgId: 'org_1', teamId: 'ghost-a' },
      { orgId: 'org_2', teamId: 'ghost-b' },
    ]);
    expect(result.retired.map((r) => r.projectsUnscoped)).toEqual([1, 0]);
    const retirements = statements.filter((s) =>
      s.text.startsWith('UPDATE app.projects SET team_id'),
    );
    expect(retirements.map((s) => s.values.slice(1))).toEqual([
      ['org_1', 'ghost-a'],
      ['org_2', 'ghost-b'],
    ]);
  });

  it('writes nothing for a healthy fleet', async () => {
    const { sql, statements } = fakeSql(() => undefined);
    const result = await repairTeamScopes(sql);
    expect(result).toEqual({ ghosts: [], retired: [] });
    expect(statements).toHaveLength(1);
  });
});
