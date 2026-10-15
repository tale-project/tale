import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findOrganizationMember } from '../../auth/membership.ts';
import { agentReachesProject, readAgentReach } from './dispatch-reach.ts';
import { readStoredDispatch } from './dispatch-store.ts';
import { agentReviewerEligibility, resolveTaskReviewer } from './reviews.ts';
import type { TaskRow } from './service.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
  setMembershipAccessLossHook: vi.fn(),
}));
vi.mock('./dispatch-reach.ts', () => ({
  agentReachesProject: vi.fn(),
  readAgentReach: vi.fn(),
}));
vi.mock('./dispatch-store.ts', () => ({ readStoredDispatch: vi.fn() }));

/**
 * Development's dispatch serves Billing: its Coder produces the work, its
 * Reviewer — granted task review — reviews it. Billing has a default
 * reviewer agent of its own, the Auditor.
 */
const DEVELOPMENT: ProjectDispatch = {
  enabled: true,
  agents: ['coder', 'second-coder'],
  maxConcurrentRuns: 4,
  statuses: ['todo'],
  assignment: 'pool',
  sources: [{ projectId: 'p-vat' }],
  reviewers: ['coder', 'reviewer'],
};

/** Agents by id: their project and their tools. */
const AGENTS: Record<string, { projectId: string; tools: string[] }> = {
  coder: { projectId: 'p-dev', tools: ['task_review'] },
  'second-coder': { projectId: 'p-dev', tools: [] },
  reviewer: { projectId: 'p-dev', tools: ['task_review'] },
  reporter: { projectId: 'p-dev', tools: [] },
  auditor: { projectId: 'p-vat', tools: ['task_review'] },
};

/** The agent reads routing makes, answered by id and project; and the
 * board's default reviewer agent. */
function database(): TransactionSql {
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.project_agents')) {
      const agent = AGENTS[String(values[0])];
      const projectId = text.includes('project_id =') ? values[2] : undefined;
      return Promise.resolve(
        agent === undefined ||
          (projectId !== undefined && agent.projectId !== projectId)
          ? []
          : [{ tools: agent.tools }],
      );
    }
    if (text.includes('default_task_reviewer_agent_id')) {
      return Promise.resolve([{ agentId: 'auditor' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- routing uses only the tagged template and unsafe; the rows model its reads
  return Object.assign(query, {
    unsafe: (text: string) => text,
  }) as unknown as TransactionSql;
}

function task(fields: Partial<TaskRow> = {}): TaskRow {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- routing reads only these fields of the row
  return {
    id: 'task-vat',
    organizationId: 'org',
    projectId: 'p-vat',
    assigneeType: 'agent',
    assigneeId: 'coder',
    reviewerUserId: null,
    reviewerAgentId: null,
    createdByType: 'user',
    createdBy: 'bea',
    ...fields,
  } as TaskRow;
}

/** Development reaches Billing for its agents, while it may. */
function reaching(reached: string[]) {
  vi.mocked(readAgentReach).mockImplementation((_sql, args) => {
    const agent = AGENTS[args.agentId];
    return Promise.resolve(
      agent === undefined
        ? null
        : {
            homeProjectId: agent.projectId,
            reachedProjectIds:
              agent.projectId === 'p-dev' && args.agentId !== 'reporter'
                ? reached
                : [],
          },
    );
  });
  vi.mocked(agentReachesProject).mockImplementation((_sql, args) =>
    Promise.resolve(
      AGENTS[args.agentId]?.projectId === args.projectId ||
        (AGENTS[args.agentId]?.projectId === 'p-dev' &&
          args.agentId !== 'reporter' &&
          reached.includes(args.projectId)),
    ),
  );
  vi.mocked(readStoredDispatch).mockResolvedValue({
    config: DEVELOPMENT,
    updatedAt: 1,
    updatedBy: 'ada',
  });
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('a dispatch’s reviewers review its pool’s work on every board it serves [TASK-R75]', () => {
  it('sends the review of the Coder’s work on Billing to Development’s Reviewer, not to Billing’s default', async () => {
    reaching(['p-vat']);
    expect(await resolveTaskReviewer(database(), task())).toEqual({
      kind: 'agent',
      agentId: 'reviewer',
    });
  });

  it('never sends work to the reviewer that produced it', async () => {
    reaching(['p-vat']);
    // The Coder is the first reviewer the dispatch names, and the producer.
    expect(
      await resolveTaskReviewer(database(), task({ assigneeId: 'coder' })),
    ).toEqual({ kind: 'agent', agentId: 'reviewer' });
    // Another agent of the pool's work goes to the first that may review.
    expect(
      await resolveTaskReviewer(
        database(),
        task({ assigneeId: 'second-coder' }),
      ),
    ).toEqual({ kind: 'agent', agentId: 'coder' });
  });

  it('keeps the reviewer a task names, an agent or a person', async () => {
    reaching(['p-vat']);
    expect(
      await resolveTaskReviewer(
        database(),
        task({ reviewerAgentId: 'auditor' }),
      ),
    ).toEqual({ kind: 'agent', agentId: 'auditor' });
    vi.mocked(findOrganizationMember).mockResolvedValue({
      id: 'm',
      organizationId: 'org',
      userId: 'bea',
      role: 'admin',
    } as Awaited<ReturnType<typeof findOrganizationMember>>);
    expect(
      await resolveTaskReviewer(database(), task({ reviewerUserId: 'bea' })),
    ).toEqual({ kind: 'user', userId: 'bea' });
    expect(readStoredDispatch).not.toHaveBeenCalled();
  });

  it('leaves work outside the pool, or on a board it no longer reaches, to the board’s own reviewer', async () => {
    reaching(['p-vat']);
    expect(
      await resolveTaskReviewer(database(), task({ assigneeId: 'reporter' })),
    ).toEqual({ kind: 'agent', agentId: 'auditor' });
    reaching([]);
    expect(await resolveTaskReviewer(database(), task())).toEqual({
      kind: 'agent',
      agentId: 'auditor',
    });
  });

  it('lets an agent that reaches a board review there, and no agent of another board', async () => {
    reaching(['p-vat']);
    const eligibility = (agentId: string) =>
      agentReviewerEligibility(database(), {
        organizationId: 'org',
        projectId: 'p-vat',
        agentId,
      });
    expect(await eligibility('reviewer')).toBe('eligible');
    expect(await eligibility('second-coder')).toBe('permission_missing');
    expect(await eligibility('reporter')).toBe('reviewer_unavailable');
    expect(await eligibility('auditor')).toBe('eligible');
  });
});
