// @vitest-environment node

/**
 * The hub folder doors take the documents write role (#3592).
 * `updateFolderTeams` rewrites the audience of every folder and document
 * below the folder, so a read-only `member` who could re-team a team folder
 * published documents they may not change themselves — while create and
 * rename checked only that the caller could see the folder. Each door now
 * refuses a member before it writes anything, and a project folder still
 * answers to the project matrix, refusal for refusal.
 */

import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  createFolder,
  FolderError,
  renameFolder,
  updateFolderTeams,
  type FolderRow,
} from './service.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const ORG = 'org-1';
const TEAM_A = 'team-a';
const TEAM_B = 'team-b';

const folderRow = (
  id: string,
  overrides: Partial<FolderRow> = {},
): FolderRow => ({
  id,
  organizationId: ORG,
  name: id,
  parentId: null,
  teamId: null,
  teamTags: [],
  projectId: null,
  createdBy: 'user-owner',
  createdAt: 1,
  ...overrides,
});

const FOLDERS: Record<string, FolderRow> = {
  // A team-A root folder: the subtree #3592 published.
  restricted: folderRow('restricted', {
    teamId: TEAM_A,
    teamTags: [TEAM_A],
  }),
  // Another organization's hub folder.
  foreign: folderRow('foreign', { organizationId: 'org-2' }),
  // Project folders: of an organization-wide project and of a team-B one.
  projectOpen: folderRow('projectOpen', { projectId: 'p-open' }),
  projectTeamB: folderRow('projectTeamB', { projectId: 'p-team-b' }),
};

const PROJECTS: Record<string, Record<string, unknown>> = {
  'p-open': {
    id: 'p-open',
    organizationId: ORG,
    teamIds: [],
    teamId: null,
    sharedWithTeamIds: [],
    archivedAt: null,
  },
  'p-team-b': {
    id: 'p-team-b',
    organizationId: ORG,
    teamIds: [TEAM_B],
    teamId: TEAM_B,
    sharedWithTeamIds: [],
    archivedAt: null,
  },
};

const ORG_TEAMS = new Set([TEAM_A, TEAM_B]);

interface Statement {
  text: string;
  values: unknown[];
}

/** A postgres.js transaction stand-in answering from the fixtures above,
 * recording every statement so a test can say what was — and was not —
 * written. */
function fakeTx(): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const answer = (text: string, values: unknown[]): unknown => {
    if (text.includes('FROM app.folders WHERE id = ? LIMIT 1')) {
      const folder = FOLDERS[String(values[1])];
      return folder ? [folder] : [];
    }
    if (text.includes('FROM app.projects WHERE id = ? LIMIT 1')) {
      const project = PROJECTS[String(values[1])];
      return project ? [project] : [];
    }
    if (text.startsWith('SELECT "id" FROM "team"')) {
      const asked = values[1];
      return Array.isArray(asked)
        ? asked.filter((id) => ORG_TEAMS.has(String(id))).map((id) => ({ id }))
        : [];
    }
    if (text.includes('SELECT max(depth)::int AS depth FROM chain')) {
      return [{ depth: 1 }];
    }
    if (text.startsWith('INSERT INTO app.folders')) {
      return [{ id: 'created' }];
    }
    return [];
  };
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

/** What the statements wrote, as `<verb> <table>` in order. */
const writes = (statements: readonly Statement[]): string[] =>
  statements.flatMap((s) => {
    const match = /\b(INSERT INTO|UPDATE) app\.(\w+)/.exec(s.text);
    if (!match) return [];
    return [`${match[1] === 'UPDATE' ? 'UPDATE' : 'INSERT'} ${match[2]}`];
  });

const as = (role: string, teamIds: string[] = [TEAM_A]) => ({
  organizationId: ORG,
  userId: `user-${role}`,
  role,
  teamIds,
});

async function refusal(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }
  return undefined;
}

type Door = (tx: TransactionSql, role: string) => Promise<unknown>;

/** Each hub folder write, and the rows it changes when it is allowed. */
const DOORS: [name: string, write: Door, wrote: string[]][] = [
  [
    'create a root folder',
    (tx, role) => createFolder(tx, as(role), { name: 'Minutes' }),
    ['INSERT folders'],
  ],
  [
    'create a folder inside a team folder',
    (tx, role) =>
      createFolder(tx, as(role), { name: 'Minutes', parentId: 'restricted' }),
    ['INSERT folders'],
  ],
  [
    'rename a team folder',
    (tx, role) => renameFolder(tx, as(role), 'restricted', 'Renamed'),
    ['UPDATE folders'],
  ],
  [
    'publish a team folder to the whole organization',
    (tx, role) =>
      updateFolderTeams(tx, as(role), { folderId: 'restricted', teamIds: [] }),
    // The cascade: the subtree's folders, then the documents inside them.
    ['UPDATE folders', 'UPDATE documents'],
  ],
];

describe.each(DOORS)('%s', (_door, write, wrote) => {
  it.each(['member', 'disabled', 'wizard'])(
    'refuses the %s role before anything is written [FOLDER-R1]',
    async (role) => {
      const { tx, statements } = fakeTx();
      const error = await refusal(write(tx, role));
      expect(error).toBeInstanceOf(FolderError);
      expect(error).toMatchObject({
        code: 'RBAC_FORBIDDEN',
        status: 403,
        message: 'Editor role required',
      });
      expect(writes(statements)).toEqual([]);
    },
  );

  it.each(['owner', 'admin', 'developer', 'editor'])(
    'lets the %s role write [FOLDER-R1]',
    async (role) => {
      const { tx, statements } = fakeTx();
      await write(tx, role);
      expect(writes(statements)).toEqual(wrote);
    },
  );
});

describe('the organization and team boundaries answer before the role', () => {
  it.each(['member', 'editor'])(
    'another organization’s folder is not found for a %s [FOLDER-R2]',
    async (role) => {
      const { tx, statements } = fakeTx();
      expect(
        await refusal(renameFolder(tx, as(role), 'foreign', 'Mine now')),
      ).toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
      expect(
        await refusal(
          updateFolderTeams(tx, as(role), { folderId: 'foreign', teamIds: [] }),
        ),
      ).toMatchObject({ code: 'FOLDER_NOT_FOUND', status: 404 });
      expect(
        await refusal(
          createFolder(tx, as(role), { name: 'Minutes', parentId: 'foreign' }),
        ),
      ).toMatchObject({ code: 'FOLDER_PARENT_NOT_FOUND', status: 404 });
      expect(writes(statements)).toEqual([]);
    },
  );

  it.each(['member', 'editor'])(
    'a team folder the %s cannot see stays out of reach [FOLDER-R3]',
    async (role) => {
      const { tx, statements } = fakeTx();
      const outsider = as(role, [TEAM_B]);
      expect(
        await refusal(renameFolder(tx, outsider, 'restricted', 'Mine now')),
      ).toMatchObject({ code: 'FOLDER_NOT_ACCESSIBLE', status: 403 });
      expect(
        await refusal(
          updateFolderTeams(tx, outsider, {
            folderId: 'restricted',
            teamIds: [],
          }),
        ),
      ).toMatchObject({ code: 'FOLDER_ACCESS_DENIED', status: 403 });
      expect(
        await refusal(
          createFolder(tx, outsider, {
            name: 'Minutes',
            parentId: 'restricted',
          }),
        ),
      ).toMatchObject({ code: 'FOLDER_PARENT_NOT_ACCESSIBLE', status: 403 });
      expect(writes(statements)).toEqual([]);
    },
  );

  it('an editor still files only into their own teams [FOLDER-R4]', async () => {
    const { tx, statements } = fakeTx();
    expect(
      await refusal(
        updateFolderTeams(tx, as('editor'), {
          folderId: 'restricted',
          teamIds: [TEAM_B],
        }),
      ),
    ).toMatchObject({ code: 'FOLDER_TEAM_FORBIDDEN', status: 403 });
    expect(
      await refusal(
        createFolder(tx, as('editor'), { name: 'Minutes', teamIds: [TEAM_B] }),
      ),
    ).toMatchObject({ code: 'FOLDER_TEAM_FORBIDDEN', status: 403 });
    expect(writes(statements)).toEqual([]);
  });
});

describe('a project folder keeps the project matrix [FOLDER-R5]', () => {
  it('refuses a member with the project gate’s own answers', async () => {
    // A project the member can read: the gate's role refusal, decided on
    // the project row.
    const readable = fakeTx();
    expect(
      await refusal(
        createFolder(readable.tx, as('member'), {
          name: 'Minutes',
          projectId: 'p-open',
        }),
      ),
    ).toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
    expect(
      await refusal(
        renameFolder(readable.tx, as('member'), 'projectOpen', 'Renamed'),
      ),
    ).toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
    expect(
      readable.statements.filter((s) => s.text.includes('FROM app.projects')),
    ).toHaveLength(2);
    // A project the member cannot read: PROJECT_FORBIDDEN, as before.
    const unreadable = fakeTx();
    expect(
      await refusal(
        createFolder(unreadable.tx, as('member'), {
          name: 'Minutes',
          parentId: 'projectTeamB',
        }),
      ),
    ).toMatchObject({ code: 'PROJECT_FORBIDDEN', status: 403 });
    expect(
      await refusal(
        renameFolder(unreadable.tx, as('member'), 'projectTeamB', 'Renamed'),
      ),
    ).toMatchObject({ code: 'PROJECT_FORBIDDEN', status: 403 });
    // Teams are a hub concept: the scope conflict, whoever asks.
    expect(
      await refusal(
        updateFolderTeams(unreadable.tx, as('member'), {
          folderId: 'projectOpen',
          teamIds: [],
        }),
      ),
    ).toMatchObject({ code: 'FOLDER_SCOPE_CONFLICT', status: 400 });
    expect(writes([...readable.statements, ...unreadable.statements])).toEqual(
      [],
    );
  });

  it('lets an editor create and rename project folders', async () => {
    const { tx, statements } = fakeTx();
    await createFolder(tx, as('editor'), {
      name: 'Minutes',
      projectId: 'p-open',
    });
    await renameFolder(tx, as('editor'), 'projectOpen', 'Renamed');
    expect(writes(statements)).toEqual(['INSERT folders', 'UPDATE folders']);
  });
});
