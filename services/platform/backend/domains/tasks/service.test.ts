import { describe, expect, it } from 'vitest';

import type { ProjectAuthContext, ProjectRow } from '../projects/service.ts';
import {
  assertTaskReadable,
  assertTaskWritable,
  assigneeChanges,
  TaskError,
} from './service.ts';

const project = (overrides: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'proj-1',
  organizationId: 'org-a',
  name: 'Board',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  knowledgeMode: null,
  agentMode: null,
  recommendedAgentSlugs: [],
  allowedAgentSlugs: [],
  modelMode: null,
  recommendedModels: [],
  allowedModels: [],
  connectorsMode: null,
  allowedConnectorSlugs: [],
  createdBy: 'user-1',
  createdAt: 0,
  updatedAt: 0,
  archivedAt: null,
  pinnedAt: null,
  ...overrides,
});

const auth = (
  overrides: Partial<ProjectAuthContext> = {},
): ProjectAuthContext => ({
  organizationId: 'org-a',
  userId: 'user-1',
  role: 'owner',
  teamIds: [],
  ...overrides,
});

const thrown = (run: () => void): TaskError => {
  try {
    run();
  } catch (error) {
    if (error instanceof TaskError) return error;
    throw error;
  }
  throw new Error('expected a TaskError');
};

describe('task guards — tenant isolation', () => {
  it('a foreign org project answers as MISSING even for an owner', () => {
    // The role matrix is org-relative: an org-B owner is nobody in org A,
    // and the admin bypass inside checkProjectAccess must never run across
    // the org boundary. 404 (not 403) so a leaked id confirms nothing.
    const foreign = auth({ organizationId: 'org-b', role: 'owner' });
    const read = thrown(() => assertTaskReadable(project(), foreign));
    expect(read.code).toBe('PROJECT_NOT_FOUND');
    expect(read.status).toBe(404);
    const write = thrown(() => assertTaskWritable(project(), foreign));
    expect(write.code).toBe('PROJECT_NOT_FOUND');
    expect(write.status).toBe(404);
  });

  it('the cross-org refusal is indistinguishable from a missing project', () => {
    // Same code + status the projects domain answers for an id that does
    // not exist at all — org membership is not confirmable by probing.
    const error = thrown(() =>
      assertTaskReadable(project(), auth({ organizationId: 'org-b' })),
    );
    expect({ code: error.code, status: error.status }).toEqual({
      code: 'PROJECT_NOT_FOUND',
      status: 404,
    });
  });

  it('a team-restricted project stays visible only to its teams', () => {
    const restricted = project({ teamId: 'team-1' });
    expect(() =>
      assertTaskReadable(
        restricted,
        auth({ role: 'member', teamIds: ['team-1'] }),
      ),
    ).not.toThrow();
    const refused = thrown(() =>
      assertTaskReadable(restricted, auth({ role: 'member', teamIds: [] })),
    );
    expect(refused.code).toBe('TASK_FORBIDDEN');
    expect(refused.status).toBe(403);
  });
});

describe('task guards — write access', () => {
  it('a read-only member can read but never write', () => {
    // 'member' is not in EDITOR_ROLES: org-wide projects are readable to
    // every role, but every task mutation (status, runs, reviews) is edit.
    const member = auth({ role: 'member' });
    expect(() => assertTaskReadable(project(), member)).not.toThrow();
    const refused = thrown(() => assertTaskWritable(project(), member));
    expect(refused.code).toBe('RBAC_FORBIDDEN');
    expect(refused.status).toBe(403);
  });

  it('editors and admins of the SAME org pass the write gate', () => {
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      expect(() => assertTaskWritable(project(), auth({ role }))).not.toThrow();
    }
  });
});

describe('assigneeChanges — one transfer rule for the picker and the bulk bar', () => {
  // The live-run gate refuses (single card) or skips (bulk) exactly when the
  // write TRANSFERS the task; both doors ask this one function, so they can
  // never disagree about what a transfer is.
  const held = { assigneeType: 'agent' as const, assigneeId: 'agent-1' };
  const idle = { assigneeType: null, assigneeId: null };

  it('re-selecting the current assignee is not a transfer', () => {
    expect(assigneeChanges(held, held)).toBe(false);
  });

  it('another worker, or clearing a held task, is a transfer', () => {
    expect(
      assigneeChanges(held, { assigneeType: 'user', assigneeId: 'user-2' }),
    ).toBe(true);
    expect(assigneeChanges(held, null)).toBe(true);
  });

  it('assigning an idle task is a transfer; clearing an idle task is not', () => {
    expect(assigneeChanges(idle, held)).toBe(true);
    expect(assigneeChanges(idle, null)).toBe(false);
  });

  it('a mid-run transfer refusal is a 409 the picker can name', () => {
    const error = new TaskError('TASK_HAS_LIVE_RUN', 'held', 409);
    expect(error.status).toBe(409);
    expect(error.code).toBe('TASK_HAS_LIVE_RUN');
  });
});
