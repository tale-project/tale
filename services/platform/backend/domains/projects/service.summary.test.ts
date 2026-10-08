// @vitest-environment node
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  getProject,
  listProjects,
  listProjectsOverview,
  listSidebarProjects,
  searchProjects,
  type ProjectAuthContext,
  type ProjectRow,
} from './service.ts';

const auth: ProjectAuthContext = {
  organizationId: 'org-a',
  userId: 'user-1',
  role: 'owner',
  teamIds: [],
};
const project: ProjectRow = {
  id: 'p1',
  organizationId: auth.organizationId,
  name: 'Apollo',
  description: 'Keep this card description',
  icon: null,
  color: null,
  key: 'APO',
  externalItemId: null,
  taskCounter: 2,
  openTaskCount: 1,
  doneTaskCount: 1,
  projectAgentCount: 0,
  defaultTaskReviewerAgentId: null,
  teamIds: [],
  teamId: null,
  sharedWithTeamIds: [],
  instructions: 'Retained project instructions. '.repeat(600),
  createdBy: auth.userId,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  pinnedAt: null,
};

function projectSql() {
  const columns: string[] = [];
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT')) statements.push({ text, values });
    if (!text.includes('FROM app.projects')) return Promise.resolve([]);
    return Promise.resolve([
      {
        ...project,
        instructions: columns.at(-1)?.includes('NULL AS instructions')
          ? null
          : project.instructions,
      },
    ]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => {
      columns.push(text);
      return text;
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SQL tag records static projections and returns the fixture row
  return { sql: sql as unknown as Sql, columns, statements };
}

describe('project metadata read projections', () => {
  it.each(['list', 'overview', 'sidebar', 'search'] as const)(
    'omits instructions from an opted-in %s without losing card metadata or scope',
    async (surface) => {
      const summary = projectSql();
      const full = projectSql();
      const read = async (sql: Sql, lightweight: boolean) => {
        const options = { summary: lightweight };
        if (surface === 'overview')
          return (await listProjectsOverview(sql, auth, options)).projects;
        if (surface === 'sidebar')
          return listSidebarProjects(sql, auth, 50, options);
        if (surface === 'search')
          return searchProjects(sql, auth, 'Apollo', 20, options);
        return listProjects(sql, auth, options);
      };
      const rows = await read(summary.sql, true);
      const control = await read(full.sql, false);
      expect(rows[0]).toMatchObject({
        id: project.id,
        description: project.description,
        instructions: null,
        openTaskCount: 1,
        doneTaskCount: 1,
      });
      expect(control[0]?.instructions).toBe(project.instructions);
      expect(summary.columns[0]).toContain('NULL AS instructions');
      expect(full.columns[0]).not.toContain('NULL AS instructions');
      expect(summary.statements[0]?.values).toContain(auth.organizationId);
      expect(summary.statements[0]?.text).toContain('WHERE org_id =');
    },
  );

  it('keeps the default list and full detail read complete', async () => {
    const { sql, columns } = projectSql();
    const rows = await listProjects(sql, auth);
    const detail = await getProject(sql, auth, project.id);
    expect(rows[0]?.instructions).toBe(project.instructions);
    expect(detail.instructions).toBe(project.instructions);
    expect(
      columns.every((value) => !value.includes('NULL AS instructions')),
    ).toBe(true);
  });
});
