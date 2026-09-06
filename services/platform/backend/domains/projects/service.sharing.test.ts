// @vitest-environment node

/**
 * Project team scoping is validated at the boundary: every team a project
 * is scoped to (owning + shared) must be a team OF THE CALLER'S ORG. Before
 * this the write paths persisted the ids verbatim — a typo'd, deleted or
 * foreign team id produced a project no non-admin could see and the Sharing
 * select could not render (the self-inflicted twin of a ghost team), and a
 * foreign id granted access through another tenant's membership.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProject,
  ProjectError,
  updateProjectSharing,
} from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../documents/service.ts', () => ({
  recordTrashRefusalFromJson: () => null,
}));
vi.mock('../tasks/retire.ts', () => ({ retireTasksInTx: vi.fn() }));

const ORG_TEAMS = new Set(['team-sales', 'team-ops']);

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  instructions: null,
  createdBy: 'user-1',
};

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: ['team-sales'],
};

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(): { tx: TransactionSql; statements: Statement[] } {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM "team"')) {
      // The org-scoped existence read: answer only the org's own teams.
      const wanted = values.find(Array.isArray) as string[] | undefined;
      return Promise.resolve(
        (wanted ?? []).filter((id) => ORG_TEAMS.has(id)).map((id) => ({ id })),
      );
    }
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.startsWith('INSERT INTO app.projects')) {
      return Promise.resolve([{ id: 'project-new' }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const writes = (statements: Statement[]): Statement[] =>
  statements.filter((s) => /^(UPDATE|INSERT|DELETE)/.test(s.text));

afterEach(() => {
  vi.clearAllMocks();
});

describe('project team scoping — only teams of the caller org', () => {
  it('refuses to create a project scoped to a team the org does not have', async () => {
    const { tx, statements } = fakeTx();
    const attempt = createProject(tx, auth, {
      name: 'Foreign',
      teamId: 'team-of-another-tenant',
      sharedWithTeamIds: ['team-sales'],
    });
    await expect(attempt).rejects.toBeInstanceOf(ProjectError);
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_SHARING_INVALID',
      status: 400,
      data: { unknownTeamIds: ['team-of-another-tenant'] },
    });
    expect(writes(statements)).toEqual([]);
  });

  it('creates the project when every team is one of the org', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      createProject(tx, auth, {
        name: 'Ours',
        teamId: 'team-sales',
        sharedWithTeamIds: ['team-ops'],
      }),
    ).resolves.toBe('project-new');
    const existence = statements.find((s) => s.text.includes('FROM "team"'));
    expect(existence?.text).toContain('"organizationId" = ?');
    expect(existence?.values).toEqual(['org_1', ['team-sales', 'team-ops']]);
    expect(
      writes(statements).some((s) =>
        s.text.startsWith('INSERT INTO app.projects'),
      ),
    ).toBe(true);
  });

  it('skips the existence read for an org-wide project', async () => {
    const { tx, statements } = fakeTx();
    await createProject(tx, auth, { name: 'Org-wide' });
    expect(statements.some((s) => s.text.includes('FROM "team"'))).toBe(false);
  });

  it('refuses to share a project with a team the org does not have', async () => {
    const { tx, statements } = fakeTx();
    const attempt = updateProjectSharing(tx, auth, {
      projectId: 'project-1',
      teamId: 'team-sales',
      sharedWithTeamIds: ['team-ops', 'team-ghost'],
    });
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_SHARING_INVALID',
      data: { unknownTeamIds: ['team-ghost'] },
    });
    expect(writes(statements)).toEqual([]);
  });

  it('shares the project when every team is one of the org', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectSharing(tx, auth, {
      projectId: 'project-1',
      teamId: 'team-sales',
      sharedWithTeamIds: ['team-ops'],
    });
    const update = writes(statements).find((s) =>
      s.text.startsWith('UPDATE app.projects'),
    );
    expect(update?.values.slice(0, 2)).toEqual(['team-sales', ['team-ops']]);
  });
});
