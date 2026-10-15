// @vitest-environment node

/**
 * Who a project agent's run answers to on a board its own project's
 * dispatch serves: the run gets the agent's standing workspace and full
 * equipment only for a starter who may act in both the board's project and
 * the agent's own, while the agent still reaches the board; its task tools
 * reach the other boards its starter may act in, and its own task's.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import { agentReachesProject, readAgentHome } from './dispatch-reach.ts';
import { memberEditableProjects } from './edit-right.ts';
import {
  isTaskRunConfined,
  runReachedProjects,
  sessionIdForAgentRun,
} from './run-authority.ts';

vi.mock('./dispatch-reach.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dispatch-reach.ts')>()),
  readAgentHome: vi.fn(),
  agentReachesProject: vi.fn(),
}));
vi.mock('./edit-right.ts', () => ({ memberEditableProjects: vi.fn() }));

/** Every read these rules make goes through the mocks above; a schedule's
 * binding reads Billing alone. */
const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
  Promise.resolve(
    strings.join('?').includes('FROM app.automation_triggers') &&
      values.includes('p-billing')
      ? [{ id: 'trigger-1' }]
      : [],
  )) as unknown as Sql;

const STANDING = standingSessionIdForProjectAgent('coder');

/** Bea edits these projects, and nothing else. */
function beaEdits(...projectIds: string[]) {
  vi.mocked(memberEditableProjects).mockImplementation((_sql, args) =>
    Promise.resolve(
      new Set(args.projectIds.filter((id) => projectIds.includes(id))),
    ),
  );
}

/** The Coder of Development, on a task of Billing, which Development's
 * dispatch serves (or no longer does). */
function coderOnBilling(reaches = true) {
  vi.mocked(readAgentHome).mockResolvedValue({
    projectId: 'p-dev',
    archived: false,
  });
  vi.mocked(agentReachesProject).mockResolvedValue(reaches);
}

const run = {
  organizationId: 'org-1',
  projectId: 'p-billing',
  agentId: 'coder',
  startedBy: 'user:bea',
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('a run on a board another project’s dispatch serves answers to both projects [TASK-R79]', () => {
  it('confines the run of someone who edits only the served board: a workspace of their own, no agent equipment', async () => {
    coderOnBilling();
    beaEdits('p-billing');
    expect(await sessionIdForAgentRun(sql, run)).toBe(
      memberSessionIdForProjectAgent('coder', 'bea'),
    );
    expect(await isTaskRunConfined(sql, { ...run, sessionId: STANDING })).toBe(
      true,
    );
  });

  it('confines the run of someone who edits only the agent’s own project', async () => {
    coderOnBilling();
    beaEdits('p-dev');
    expect(await sessionIdForAgentRun(sql, run)).toBe(
      memberSessionIdForProjectAgent('coder', 'bea'),
    );
    expect(await isTaskRunConfined(sql, { ...run, sessionId: STANDING })).toBe(
      true,
    );
  });

  it('gives the standing workspace to someone who edits both, while the agent reaches the board', async () => {
    coderOnBilling();
    beaEdits('p-billing', 'p-dev');
    expect(await sessionIdForAgentRun(sql, run)).toBe(STANDING);
    expect(await isTaskRunConfined(sql, { ...run, sessionId: STANDING })).toBe(
      false,
    );
  });

  it('confines a queued run whose board the agent no longer reaches, whoever started it', async () => {
    coderOnBilling(false);
    beaEdits('p-billing', 'p-dev');
    expect(await isTaskRunConfined(sql, { ...run, sessionId: STANDING })).toBe(
      true,
    );
  });

  it('judges a run on the agent’s own board on that board alone, as before', async () => {
    coderOnBilling();
    beaEdits('p-dev');
    expect(
      await isTaskRunConfined(sql, {
        ...run,
        projectId: 'p-dev',
        sessionId: STANDING,
      }),
    ).toBe(false);
    expect(agentReachesProject).not.toHaveBeenCalled();
  });

  it('confines a schedule’s run that may act on the served board but not in the agent’s own project', async () => {
    coderOnBilling();
    expect(
      await isTaskRunConfined(sql, {
        ...run,
        startedBy: 'trigger:trigger-1',
        sessionId: STANDING,
      }),
    ).toBe(true);
  });
});

describe('a run’s task tools reach the served boards its starter may act in [TASK-R79]', () => {
  const reach = {
    organizationId: 'org-1',
    homeProjectId: 'p-dev',
    reachedProjectIds: ['p-billing', 'p-jordi'],
  };

  it('keeps a person’s run to the boards they edit, and its own task’s', async () => {
    beaEdits('p-dev');
    expect(
      await runReachedProjects(sql, {
        ...reach,
        run: { projectId: 'p-billing', startedBy: 'user:bea' },
      }),
    ).toEqual(['p-billing']);
    beaEdits('p-dev', 'p-jordi');
    expect(
      await runReachedProjects(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'user:bea' },
      }),
    ).toEqual(['p-jordi']);
  });

  it('lets a run the agent’s own dispatch started reach every board it serves', async () => {
    expect(
      await runReachedProjects(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'dispatch:p-dev' },
      }),
    ).toEqual(['p-billing', 'p-jordi']);
    expect(memberEditableProjects).not.toHaveBeenCalled();
  });

  it('keeps a schedule’s run to the boards its automation is bound to', async () => {
    expect(
      await runReachedProjects(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'trigger:trigger-1' },
      }),
    ).toEqual(['p-billing']);
  });
});
