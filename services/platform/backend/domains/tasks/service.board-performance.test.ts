// @vitest-environment node
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectAuthContext, ProjectRow } from '../projects/service.ts';

const { loadProjectOrThrow } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
}));

import {
  BOARD_TASK_COLUMNS,
  listTasksByProject,
  listTasksForAccessibleProjects,
  TASK_COLUMNS,
  type TaskRow,
} from './service.ts';

const auth: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-1',
  role: 'owner',
  teamIds: [],
};

function project(id: string): ProjectRow {
  return {
    id,
    organizationId: auth.organizationId,
    name: id,
    description: null,
    icon: null,
    color: null,
    key: id.toUpperCase(),
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
    createdBy: auth.userId,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    pinnedAt: null,
  };
}

function task(
  id: string,
  projectId: string,
  externalId: string | null,
): TaskRow {
  return {
    id,
    organizationId: auth.organizationId,
    projectId,
    title: id,
    description: 'A large retained body',
    attachments: [],
    outputs: [],
    number: 1,
    status: 'todo',
    priority: null,
    labelIds: [],
    assigneeType: null,
    assigneeId: null,
    reviewerUserId: null,
    reviewerAgentId: null,
    parentTaskId: null,
    commentCount: 0,
    rank: id,
    externalSystem: null,
    externalId,
    externalUrl: null,
    externalIssue: {
      id: 'issue-1',
      title: 'External title',
      description: 'Retained upstream body',
      url: 'https://example.test/issues/1',
      state: 'open',
      syncedAt: 1,
    },
    threadId: null,
    discussionThreadId: null,
    sourceDiscussionThreadId: null,
    startDate: null,
    startNotifiedAt: null,
    dueDate: null,
    slaLevel: null,
    slaLevelAt: null,
    statusChangedAt: null,
    totalCostCents: null,
    agentRunCount: 0,
    lastAgentRunAt: null,
    claimedAt: null,
    completedAt: null,
    externalClosedAt: null,
    repeat: null,
    repeatNextTaskId: null,
    repeatContinued: false,
    createdBy: auth.userId,
    createdByType: 'user',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
}

/** The SQL tag of a board read: `tasks` answer the task read, which the
 * readable projects join with their keys (`keyOf`), and `folders` the
 * folder walk. */
function boardSql(
  tasks: TaskRow[],
  folders: Array<{ rootId: string; projectId: string; hasFiles: boolean }>,
  keyOf: (projectId: string) => string | null = (projectId) =>
    projectId.toUpperCase(),
) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const columns: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    if (/^(SELECT|WITH RECURSIVE)\b/.test(text))
      statements.push({ text, values });
    if (text.includes('FROM app.tasks t')) {
      const joined = text.includes('rp.project_key AS "projectKey"');
      return Promise.resolve(
        tasks.map((row) => {
          const key = joined ? { projectKey: keyOf(row.projectId) } : {};
          if (values[0] !== BOARD_TASK_COLUMNS) return { ...row, ...key };
          const {
            description: _description,
            attachments: _attachments,
            outputs: _outputs,
            externalIssue: _externalIssue,
            ...metadata
          } = row;
          return { ...metadata, ...key };
        }),
      );
    }
    if (text.startsWith('WITH RECURSIVE tree')) return Promise.resolve(folders);
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => {
      columns.push(text);
      return text;
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers the SQL tag and records its immutable column fragments
  return { sql: sql as unknown as Sql, statements, columns };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadProjectOrThrow.mockResolvedValue(project('p0'));
});

describe('task board reads scale with the page, rather than its project count', () => {
  it('reads folder facts once for forty projects, deduplicating exact root bindings', async () => {
    const projects = Array.from({ length: 40 }, (_, i) => project(`p${i}`));
    const tasks = projects.flatMap(({ id }, i) => [
      task(`t${i}-a`, id, `f${i}`),
      task(`t${i}-b`, id, `f${i}`),
    ]);
    const folders = projects.map(({ id }, i) => ({
      rootId: `f${i}`,
      projectId: id,
      hasFiles: i % 2 === 0,
    }));
    const { sql, statements } = boardSql(tasks, folders);
    const result = await listTasksForAccessibleProjects(sql, auth);

    expect(result.tasks).toHaveLength(80);
    const walks = statements.filter(({ text }) =>
      text.startsWith('WITH RECURSIVE'),
    );
    expect(walks).toHaveLength(1);
    const walk = walks[0];
    expect(walk?.values[0]).toHaveLength(40);
    expect(walk?.values[0]).toEqual(
      expect.arrayContaining(folders.map(({ rootId }) => rootId)),
    );
    expect(walk?.values[1]).toHaveLength(40);
    expect(walk?.values[1]).toEqual(
      expect.arrayContaining(projects.map(({ id }) => id)),
    );
    const roots = walk?.values[0];
    const scopes = walk?.values[1];
    expect(
      Array.isArray(roots) &&
        Array.isArray(scopes) &&
        roots.every(
          (root, i) =>
            typeof root === 'string' && scopes[i] === `p${root.slice(1)}`,
        ),
    ).toBe(true);
    expect(walk?.text).toContain(
      'f.id = roots.id AND f.project_id = roots.project_id',
    );
    expect(walk?.text).toContain('f.project_id = t.project_id');
    expect(
      walk?.values.filter((value) => value === auth.organizationId),
    ).toHaveLength(3);
    for (const row of result.tasks) {
      expect(row.folderExists).toBe(true);
      expect(row.hasFiles).toBe(Number(row.projectId.slice(1)) % 2 === 0);
      expect(row.projectKey).toBe(row.projectId.toUpperCase());
    }
  });

  it('keeps folder facts under their project, including a wrong-project binding and missing roots', async () => {
    const { sql } = boardSql(
      [
        task('bound', 'p0', 'f0'),
        task('wrong-project', 'p1', 'f0'),
        task('missing', 'p1', 'missing-root'),
        task('unbound', 'p1', null),
      ],
      [{ rootId: 'f0', projectId: 'p0', hasFiles: true }],
    );
    const result = await listTasksForAccessibleProjects(sql, auth);
    const facts = Object.fromEntries(
      result.tasks.map((row) => [row.id, [row.folderExists, row.hasFiles]]),
    );
    expect(facts).toEqual({
      bound: [true, true],
      'wrong-project': [false, false],
      missing: [false, false],
      unbound: [true, false],
    });
  });

  it('reads the readable projects in the task read itself, with no id list [PROJ-R1] [PROJ-R2]', async () => {
    const { sql, statements } = boardSql(
      [task('keyed', 'p0', null), task('keyless', 'p1', null)],
      [],
      (projectId) => (projectId === 'p0' ? 'P0' : null),
    );
    const result = await listTasksForAccessibleProjects(sql, auth);

    // One statement reads the tasks and joins the projects they may read:
    // no project list is read first and sent back as `ANY(<ids>)` (#5156).
    expect(
      statements.filter(({ text }) => text.includes('FROM app.projects')),
    ).toEqual([]);
    const read = statements.find(({ text }) =>
      text.includes('FROM app.tasks t'),
    );
    expect(read?.text).toContain(
      'rp.project_key AS "projectKey" FROM app.tasks t JOIN ? rp USING (project_id) WHERE org_id = ?',
    );
    expect(read?.text).not.toContain('ANY(');
    expect(
      Object.fromEntries(result.tasks.map((row) => [row.id, row.projectKey])),
    ).toEqual({ keyed: 'P0', keyless: undefined });
    expect(result.tasks[1]).not.toHaveProperty('projectKey');
  });

  it('does not query folders when no task names a folder', async () => {
    const { sql, statements } = boardSql([task('unbound', 'p0', null)], []);
    await listTasksByProject(sql, auth, 'p0');
    expect(
      statements.some(({ text }) => text.startsWith('WITH RECURSIVE')),
    ).toBe(false);
  });

  it.each(['project', 'all projects'])(
    'keeps %s boards thin by default, with an explicit full compatibility read',
    async (scope) => {
      const full = boardSql([task('t0', 'p0', null)], []);
      const summary = boardSql([task('t0', 'p0', null)], []);
      const defaults = boardSql([task('t0', 'p0', null)], []);
      const read = (sql: Sql, options: { summary?: boolean } = {}) =>
        scope === 'project'
          ? listTasksByProject(sql, auth, 'p0', options)
          : listTasksForAccessibleProjects(sql, auth, options);
      const result = await read(summary.sql, { summary: true });
      const control = await read(full.sql, { summary: false });
      const defaultResult = await read(defaults.sql);
      expect(defaultResult).toEqual(result);
      const bodyKeys = [
        'description',
        'attachments',
        'outputs',
        'externalIssue',
      ];
      for (const body of bodyKeys) {
        expect(result.tasks[0]).not.toHaveProperty(body);
        expect(control.tasks[0]).toHaveProperty(body);
      }
      const fullMetadata = Object.fromEntries(
        Object.entries(control.tasks[0] ?? {}).filter(
          ([key]) => !bodyKeys.includes(key),
        ),
      );
      expect(result.tasks[0]).toEqual(fullMetadata);
      expect(summary.columns[0]).toBe(BOARD_TASK_COLUMNS);
      expect(defaults.columns[0]).toBe(BOARD_TASK_COLUMNS);
      expect(full.columns[0]).toBe(TASK_COLUMNS);
      const selected = BOARD_TASK_COLUMNS.split(',').map((column) =>
        column.trim(),
      );
      for (const body of [
        'description',
        'attachments',
        'outputs',
        'external_issue AS "externalIssue"',
      ])
        expect(selected).not.toContain(body);
    },
  );
});
