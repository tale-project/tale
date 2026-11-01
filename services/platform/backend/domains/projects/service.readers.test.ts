// @vitest-environment node
/**
 * The member search offers, in a project, only the people who read it
 * (MEMBER-R12). `readableProjectTeamIds` gives the teams it narrows to, and
 * refuses a project the caller cannot read as the projects refuse it: 404
 * when the project is not theirs to know of, 403 when they may not read it.
 */
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { type ProjectAuthContext, readableProjectTeamIds } from './service.ts';

function project(id: string, organizationId: string, teamIds: string[]) {
  return {
    id,
    organizationId,
    teamIds,
    teamId: teamIds[0] ?? null,
    sharedWithTeamIds: teamIds.slice(1),
  };
}

/** Acme's Launch project belongs to Design and Ops, its Wiki is open to all
 *  of Acme, and Globex has a project of its own. */
const PROJECTS = [
  project('project-launch', 'org-acme', ['team-design', 'team-ops']),
  project('project-wiki', 'org-acme', []),
  project('project-globex', 'org-globex', ['team-design']),
];

/** A `sql` stand-in that answers the project read by id, and nothing else. */
function projectsSql(): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (!text.includes('FROM app.projects WHERE id = ?')) {
      throw new Error(`unexpected statement: ${text}`);
    }
    return Promise.resolve(PROJECTS.filter((row) => row.id === values.at(-1)));
  };
  const sql = Object.assign(tag, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return sql as unknown as Sql;
}

function acme(role: string, teamIds: string[] = []): ProjectAuthContext {
  return { organizationId: 'org-acme', userId: `user-${role}`, role, teamIds };
}

const teamsOf = (auth: ProjectAuthContext, projectId: string) =>
  readableProjectTeamIds(projectsSql(), auth, projectId);

describe('the teams a member search narrows a project to [MEMBER-R12]', () => {
  it('gives the teams of a project restricted to them, to a member of one [PROJ-R2]', async () => {
    await expect(
      teamsOf(acme('member', ['team-ops']), 'project-launch'),
    ).resolves.toEqual(['team-design', 'team-ops']);
  });

  it('gives the same teams to an admin outside them [PROJ-R1]', async () => {
    await expect(teamsOf(acme('admin'), 'project-launch')).resolves.toEqual([
      'team-design',
      'team-ops',
    ]);
  });

  it('gives no team for a project the whole organization reads', async () => {
    await expect(
      teamsOf(acme('member', ['team-ops']), 'project-wiki'),
    ).resolves.toEqual([]);
  });

  it('refuses a project that does not exist (404)', async () => {
    await expect(
      teamsOf(acme('owner'), 'project-missing'),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
  });

  it("refuses another organization's project as not found, even to an owner (404)", async () => {
    await expect(
      teamsOf(acme('owner', ['team-design']), 'project-globex'),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND', status: 404 });
  });

  it('refuses a member outside its teams, and a disabled seat anywhere (403) [PROJ-R2]', async () => {
    await expect(
      teamsOf(acme('member', ['team-sales']), 'project-launch'),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN', status: 403 });
    await expect(
      teamsOf(acme('disabled', ['team-ops']), 'project-wiki'),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN', status: 403 });
  });
});
