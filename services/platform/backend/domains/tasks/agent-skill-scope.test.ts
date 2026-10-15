// @vitest-environment node

/**
 * Whose sight narrows the skills a project agent's run stages: a run on
 * another project's board whose starter may not read the agent's own project
 * is handed only the skills that starter may see as well; every other run
 * stages what the agent's own project equips.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findActingMember, getActingAudience } from '../../auth/membership.ts';
import { readProjectAgentSkillScope } from './agent-skill-scope.ts';
import { runProjectScope } from './run-authority.ts';

vi.mock('./run-authority.ts', () => ({ runProjectScope: vi.fn() }));
vi.mock('../../auth/membership.ts', () => ({
  findActingMember: vi.fn(),
  getActingAudience: vi.fn(),
}));

/** The Coder of Development (shared with the dev team), and its runs. */
function database(
  runs: Record<string, { projectId: string; startedBy: string }>,
) {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.project_agents a')) {
      return Promise.resolve([
        { teamIds: ['dev'], projectId: 'p-dev', organizationId: 'org-1' },
      ]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      const run = runs[String(values[0])];
      return Promise.resolve(run === undefined ? [] : [run]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return Object.assign(query, {
    unsafe: (text: string) => text,
  }) as unknown as Sql;
}

const sql = database({
  'run-billing': { projectId: 'p-billing', startedBy: 'user:bea' },
  'run-dev': { projectId: 'p-dev', startedBy: 'user:bea' },
  'run-schedule': { projectId: 'p-billing', startedBy: 'trigger:t-1' },
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('a run whose starter may not read the agent’s own project is narrowed to the starter’s skills [TASK-R82]', () => {
  it('narrows Bea’s run on Billing to what Bea sees, by her teams and role', async () => {
    vi.mocked(runProjectScope).mockResolvedValue({
      ownProject: false,
      reachedProjectIds: ['p-billing'],
    });
    vi.mocked(findActingMember).mockResolvedValue({
      id: 'm-bea',
      organizationId: 'org-1',
      userId: 'bea',
      role: 'editor',
    } as never);
    vi.mocked(getActingAudience).mockResolvedValue({
      teamIds: ['billing'],
    } as never);
    await expect(
      readProjectAgentSkillScope(sql, 'coder', 'run-billing'),
    ).resolves.toEqual({
      teamIds: ['dev'],
      starter: {
        kind: 'user',
        userId: 'bea',
        teamIds: ['billing'],
        isOrgAdmin: false,
      },
    });
    expect(vi.mocked(runProjectScope).mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      homeProjectId: 'p-dev',
      reachedProjectIds: [],
      run: { projectId: 'p-billing', startedBy: 'user:bea' },
    });
  });

  it('leaves the run whole for a starter who may read the agent’s own project', async () => {
    vi.mocked(runProjectScope).mockResolvedValue({
      ownProject: true,
      reachedProjectIds: ['p-billing'],
    });
    await expect(
      readProjectAgentSkillScope(sql, 'coder', 'run-billing'),
    ).resolves.toEqual({ teamIds: ['dev'] });
  });

  it('never narrows a run on the agent’s own board, nor a read without a run', async () => {
    await expect(
      readProjectAgentSkillScope(sql, 'coder', 'run-dev'),
    ).resolves.toEqual({ teamIds: ['dev'] });
    await expect(readProjectAgentSkillScope(sql, 'coder')).resolves.toEqual({
      teamIds: ['dev'],
    });
    expect(runProjectScope).not.toHaveBeenCalled();
  });

  it('narrows a schedule’s run, and a starter no longer in the organization, to the organization’s skills', async () => {
    vi.mocked(runProjectScope).mockResolvedValue({
      ownProject: false,
      reachedProjectIds: ['p-billing'],
    });
    await expect(
      readProjectAgentSkillScope(sql, 'coder', 'run-schedule'),
    ).resolves.toEqual({ teamIds: ['dev'], starter: { kind: 'org' } });
    vi.mocked(findActingMember).mockResolvedValue(null);
    await expect(
      readProjectAgentSkillScope(sql, 'coder', 'run-billing'),
    ).resolves.toEqual({ teamIds: ['dev'], starter: { kind: 'org' } });
  });
});
