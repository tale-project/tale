/**
 * The board's search is a board filter (#3745). The tasks page used to
 * intersect its board read with the palette's search — whose first 25 hits
 * ignore the board's facets — so a task the facets kept could fall outside
 * those 25 and the lanes read empty. The query now narrows the board read
 * itself, in the statement that carries the board's `LIMIT`, with the same
 * two legs the palette uses: the task's own fields, or one comment on it.
 *
 * Postgres proves the matching itself (`board-search.integration.ts`); these
 * tests pin where the match sits and that the palette and the board share it.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectAuthContext, ProjectRow } from '../projects/service.ts';

const { loadProjectOrThrow, listProjects } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
  listProjects,
}));

import {
  BOARD_TASK_COLUMNS,
  listTasksByProject,
  listTasksForAccessibleProjects,
  searchTasks,
  TASK_COLUMNS,
  taskSearchPatterns,
} from './service.ts';

const FRAGMENT = Symbol('fragment');
interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A `sql` stand-in that inlines nested fragments the way postgres.js does,
 *  so a recorded statement is the one Postgres would see. */
function recordingSql() {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve([]), fragment);
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const project = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'proj-1',
  organizationId: 'org-a',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: 'WEB',
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  defaultTaskReviewerAgentId: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  pinnedAt: null,
  ...overrides,
});

const auth: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-1',
  role: 'owner',
  teamIds: [],
};

/** The statement that reads the board's task rows. */
function boardStatement(statements: { text: string; values: unknown[] }[]) {
  const found = statements.find((s) => s.text.includes('FROM app.tasks t'));
  if (!found) throw new Error('no board statement was issued');
  return found;
}

/** The fields leg as it appears in a statement: from the haystack to its
 *  `LIKE ALL`. */
function fieldsLeg(text: string): string {
  const match = /lower\( t\.title .*?\) LIKE ALL\(\?\)/.exec(text);
  if (!match) throw new Error(`no fields leg in: ${text}`);
  return match[0];
}

const COMMENT_LEG = "lower(coalesce(m.text, '')) LIKE ALL(?)";

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectOrThrow.mockResolvedValue(project());
  listProjects.mockResolvedValue([project()]);
});

describe('taskSearchPatterns', () => {
  it('matches every token, lowercased, anywhere in the text', () => {
    expect(taskSearchPatterns('  Launch   BRIEF ')).toEqual([
      '%launch%',
      '%brief%',
    ]);
  });

  it('escapes what LIKE would read as a wildcard', () => {
    expect(taskSearchPatterns('50% a_b c\\d')).toEqual([
      String.raw`%50\%%`,
      String.raw`%a\_b%`,
      String.raw`%c\\d%`,
    ]);
  });

  it('has nothing to match for a blank query', () => {
    expect(taskSearchPatterns('   ')).toEqual([]);
  });
});

describe('the board search narrows the board read itself', () => {
  it('matches fields or one comment in the statement that carries LIMIT', async () => {
    const { sql, statements } = recordingSql();
    await listTasksByProject(sql, auth, 'proj-1', {
      statuses: ['todo', 'done'],
      query: 'Needle urgent',
    });

    const board = boardStatement(statements);
    expect(board.text).toContain(fieldsLeg(board.text));
    expect(board.text).toContain(
      'OR EXISTS ( SELECT 1 FROM app.task_discussion_message_meta meta',
    );
    expect(board.text).toContain('WHERE meta.task_id = t.id');
    expect(board.text).toContain(COMMENT_LEG);
    // Before the cap: the match and the LIMIT are one statement.
    expect(board.text).toMatch(/LIKE ALL\(\?\).*ORDER BY .*LIMIT \?$/);
    expect(board.values).toContainEqual(['%needle%', '%urgent%']);
    // The other board filters ride along in the same statement.
    expect(board.values).toContainEqual(['todo', 'done']);
    expect(board.values.at(-1)).toBe(2001);
  });

  it('reads the board unnarrowed without a query', async () => {
    const { sql, statements } = recordingSql();
    await listTasksByProject(sql, auth, 'proj-1', { query: '   ' });

    const board = boardStatement(statements);
    expect(board.text).not.toContain('LIKE ALL');
    expect(board.text).not.toContain('task_discussion_message_meta');
  });

  it('narrows the all-projects board the same way', async () => {
    const { sql, statements } = recordingSql();
    await listTasksForAccessibleProjects(sql, auth, { query: 'needle' });

    const board = boardStatement(statements);
    expect(board.text).toContain(COMMENT_LEG);
    expect(board.text).toMatch(/LIKE ALL\(\?\).*ORDER BY .*LIMIT \?$/);
    expect(board.values).toContainEqual(['%needle%']);
  });
});

/** The columns a board statement selects (its `sql.unsafe` list). */
function selectedColumns(statement: { values: unknown[] }): string[] {
  const list = statement.values.find(
    (value): value is string =>
      typeof value === 'string' && value.includes('"organizationId"'),
  );
  if (list === undefined) throw new Error('no column list in the statement');
  return list.split(',').map((column) => column.trim());
}

const LONG_COLUMNS = [
  'description',
  'attachments',
  'outputs',
  'external_issue AS "externalIssue"',
];

describe('a board row carries only what a card shows', () => {
  it('leaves the long columns out of BOARD_TASK_COLUMNS, and keeps every other task column', () => {
    const all = TASK_COLUMNS.split(',').map((column) => column.trim());
    const board = BOARD_TASK_COLUMNS.split(',').map((column) => column.trim());
    expect(board).toEqual(
      all.filter((column) => !LONG_COLUMNS.includes(column)),
    );
    expect(all.length - board.length).toBe(LONG_COLUMNS.length);
  });

  it('reads a project board and the all-projects board without them', async () => {
    const board = recordingSql();
    await listTasksByProject(board.sql, auth, 'proj-1', { query: 'needle' });
    const across = recordingSql();
    await listTasksForAccessibleProjects(across.sql, auth, {});
    for (const statements of [board.statements, across.statements]) {
      const columns = selectedColumns(boardStatement(statements));
      for (const long of LONG_COLUMNS) expect(columns).not.toContain(long);
      expect(columns).toContain('title');
      expect(columns).toContain('comment_count AS "commentCount"');
    }
    // The search still matches the description, in the WHERE clause.
    expect(boardStatement(board.statements).text).toContain(
      "coalesce(t.description, '')",
    );
  });
});

describe('the palette and the board search alike', () => {
  it('share the fields leg and the comment leg', async () => {
    const board = recordingSql();
    await listTasksByProject(board.sql, auth, 'proj-1', { query: 'needle' });
    const palette = recordingSql();
    await searchTasks(palette.sql, auth, {
      query: 'needle',
      projectId: 'proj-1',
    });

    const boardText = boardStatement(board.statements).text;
    // The recorder also logs each nested fragment; pick the two statements.
    const paletteFields = palette.statements.find((s) =>
      s.text.startsWith('SELECT t.id AS "taskId"'),
    );
    const paletteComments = palette.statements.find((s) =>
      s.text.includes('FROM app.task_discussion_message_meta meta'),
    );
    expect(paletteFields && fieldsLeg(paletteFields.text)).toBe(
      fieldsLeg(boardText),
    );
    expect(paletteComments?.text).toContain(COMMENT_LEG);
    expect(paletteFields?.values).toContainEqual(['%needle%']);
  });
});
