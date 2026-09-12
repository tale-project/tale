// @vitest-environment node

/**
 * The REST door's get-or-create folds case the way the sibling rule does,
 * answers the stored spelling, and survives the race two concurrent
 * creates can lose: the insert arbitrates on the sibling index
 * (`folders_project_sibling_name`, `ON CONFLICT … DO NOTHING`) and the
 * loser re-reads the winner's row. The regressions under test: a name that
 * differed only in case was neither branch — `FOLDER_NAME_TAKEN` forever,
 * with no rename or delete to converge through — and the refusal was a
 * 400 where every other state refusal is a 409.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  FolderError,
  getOrCreateProjectFolder,
  renameFolder,
} from './service.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const PROJECT = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
};

const auth = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(
  answer: (text: string, values: unknown[], nth: number) => unknown,
): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    const answered = answer(
      text,
      values,
      statements.filter((s) => s.text === text).length,
    );
    if (answered instanceof Error) return Promise.reject(answered);
    return Promise.resolve(answered ?? []);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const siblingLookup = (text: string) =>
  text.startsWith('SELECT id, name FROM app.folders') &&
  text.includes('lower(name) = ?');

describe('getOrCreateProjectFolder', () => {
  it('answers a sibling that differs only in case, with its stored spelling', async () => {
    const { tx, statements } = fakeTx((text) =>
      siblingLookup(text) ? [{ id: 'f-1', name: 'inbox' }] : [],
    );
    const result = await getOrCreateProjectFolder(tx, auth, {
      projectId: 'p-1',
      name: '  INBOX ',
    });
    expect(result).toEqual({ folderId: 'f-1', name: 'inbox', created: false });
    const lookup = statements.find((s) => siblingLookup(s.text));
    expect(lookup?.values).toContain('inbox');
    expect(statements.some((s) => s.text.startsWith('INSERT'))).toBe(false);
  });

  it('creates through the sibling-index-arbitrated insert', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.folders') ? [{ id: 'f-3' }] : [],
    );
    const result = await getOrCreateProjectFolder(tx, auth, {
      projectId: 'p-1',
      name: 'Inbox',
    });
    expect(result).toEqual({ folderId: 'f-3', name: 'Inbox', created: true });
    const insert = statements.find((s) => s.text.startsWith('INSERT'));
    expect(insert?.text).toContain(
      "ON CONFLICT (org_id, project_id, (coalesce(parent_id, '')), (lower(name))) WHERE project_id IS NOT NULL DO NOTHING",
    );
  });

  it('re-reads the winner when the insert loses the race, as found', async () => {
    const { tx } = fakeTx((text, _values, nth) => {
      // The first lookup sees nothing; the insert answers no row (the
      // index refused it); the re-read finds the concurrent winner.
      if (siblingLookup(text))
        return nth === 1 ? [] : [{ id: 'f-2', name: 'Inbox' }];
      if (text.startsWith('INSERT INTO app.folders')) return [];
      return [];
    });
    const result = await getOrCreateProjectFolder(tx, auth, {
      projectId: 'p-1',
      name: 'inbox',
    });
    expect(result).toEqual({ folderId: 'f-2', name: 'Inbox', created: false });
  });

  it('refuses a name that is a path with FOLDER_NAME_INVALID, before any query', async () => {
    const { tx, statements } = fakeTx(() => []);
    await expect(
      getOrCreateProjectFolder(tx, auth, { projectId: 'p-1', name: 'a/b' }),
    ).rejects.toMatchObject({ code: 'FOLDER_NAME_INVALID', status: 400 });
    expect(statements).toEqual([]);
  });
});

describe('renameFolder', () => {
  const folder = {
    id: 'f-1',
    organizationId: 'org-1',
    name: 'Inbox',
    parentId: null,
    teamId: null,
    teamTags: [] as string[],
    projectId: 'p-1',
    createdBy: 'user-1',
    createdAt: 1,
  };

  it('answers a taken sibling name as a 409, the seen one and the raced one alike', async () => {
    const seen = fakeTx((text) => {
      if (text.includes('FROM app.folders WHERE id = ?')) return [folder];
      if (text.startsWith('SELECT id FROM app.folders')) return [{ id: 'f-9' }];
      return [];
    });
    await expect(
      renameFolder(seen.tx, auth, 'f-1', 'ARCHIVE'),
    ).rejects.toMatchObject({ code: 'FOLDER_NAME_TAKEN', status: 409 });
    const raced = fakeTx((text) => {
      if (text.includes('FROM app.folders WHERE id = ?')) return [folder];
      if (text.startsWith('UPDATE app.folders SET name'))
        return Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint_name: 'folders_project_sibling_name',
        });
      return [];
    });
    let caught: unknown;
    try {
      await renameFolder(raced.tx, auth, 'f-1', 'Archive');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FolderError);
    expect(caught).toMatchObject({ code: 'FOLDER_NAME_TAKEN', status: 409 });
  });
});
