// @vitest-environment node

/**
 * Who a project agent's run answers to on a board its own project's
 * dispatch serves: the run gets the agent's standing workspace and full
 * equipment only for a starter who may act in both the board's project and
 * the agent's own, while the agent still reaches the board; its task tools
 * reach the other boards its starter may act in, and its own task's. There
 * it reads only what its starter may read: the agent's own project only for
 * someone who may read it.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
} from '../../core/sandbox/session_naming.ts';
import { agentReachesProject, readAgentHome } from './dispatch-reach.ts';
import {
  memberEditableProjects,
  memberReadableProjects,
} from './edit-right.ts';
import {
  isTaskRunConfined,
  runProjectScope,
  sessionIdForAgentRun,
} from './run-authority.ts';

vi.mock('./dispatch-reach.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dispatch-reach.ts')>()),
  readAgentHome: vi.fn(),
  agentReachesProject: vi.fn(),
}));
vi.mock('./edit-right.ts', () => ({
  memberEditableProjects: vi.fn(),
  memberReadableProjects: vi.fn(),
}));

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

/** Bea edits these projects, and nothing else; she reads them, and the
 * ones {@link beaReads} adds. */
function beaEdits(...projectIds: string[]) {
  vi.mocked(memberEditableProjects).mockImplementation((_sql, args) =>
    Promise.resolve(
      new Set(args.projectIds.filter((id) => projectIds.includes(id))),
    ),
  );
  beaReads(...projectIds);
}

/** Bea reads these projects, and nothing else. */
function beaReads(...projectIds: string[]) {
  vi.mocked(memberReadableProjects).mockImplementation((_sql, args) =>
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
    beaReads('p-dev', 'p-billing');
    expect(
      await runProjectScope(sql, {
        ...reach,
        run: { projectId: 'p-billing', startedBy: 'user:bea' },
      }),
    ).toEqual({ ownProject: true, reachedProjectIds: ['p-billing'] });
    beaEdits('p-dev', 'p-jordi');
    expect(
      await runProjectScope(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'user:bea' },
      }),
    ).toEqual({ ownProject: true, reachedProjectIds: ['p-jordi'] });
    // On the agent's own board, nobody's read right is asked.
    expect(memberReadableProjects).toHaveBeenCalledTimes(1);
  });

  it('keeps a schedule’s run to the boards its automation is bound to', async () => {
    expect(
      await runProjectScope(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'trigger:trigger-1' },
      }),
    ).toEqual({ ownProject: true, reachedProjectIds: ['p-billing'] });
  });
});

describe('a run on a served board reads only what its starter may read [TASK-R82]', () => {
  const reach = {
    organizationId: 'org-1',
    homeProjectId: 'p-dev',
    reachedProjectIds: ['p-billing', 'p-jordi'],
  };
  const onBilling = (startedBy: string) =>
    runProjectScope(sql, {
      ...reach,
      run: { projectId: 'p-billing', startedBy },
    });

  it('leaves out the agent’s own project for someone who may not read it', async () => {
    // Bea edits Billing alone; Development is shared with a team she is
    // not in.
    beaEdits('p-billing');
    expect(await onBilling('user:bea')).toEqual({
      ownProject: false,
      reachedProjectIds: ['p-billing'],
    });
    expect(vi.mocked(memberReadableProjects).mock.calls[0]?.[1]).toEqual({
      organizationId: 'org-1',
      userId: 'bea',
      projectIds: ['p-dev', 'p-billing'],
    });
  });

  it('keeps it for someone who reads it without editing it, and the boards they edit beyond', async () => {
    beaEdits('p-billing', 'p-jordi');
    beaReads('p-billing', 'p-jordi', 'p-dev');
    expect(await onBilling('user:bea')).toEqual({
      ownProject: true,
      reachedProjectIds: ['p-billing', 'p-jordi'],
    });
  });

  it('reads not even its own task’s board once its starter may no longer read it', async () => {
    beaEdits('p-dev');
    beaReads('p-dev');
    expect(await onBilling('user:bea')).toEqual({
      ownProject: true,
      reachedProjectIds: [],
    });
  });

  it('reads the agent’s own project for a schedule only while it may act there', async () => {
    // The schedule's automation is bound to Billing alone.
    expect(await onBilling('trigger:trigger-1')).toEqual({
      ownProject: false,
      reachedProjectIds: ['p-billing'],
    });
    expect(memberReadableProjects).not.toHaveBeenCalled();
  });

  it('lets a run the agent’s own dispatch started keep its project and reach every board it serves', async () => {
    expect(await onBilling('dispatch:p-dev')).toEqual({
      ownProject: true,
      reachedProjectIds: ['p-billing', 'p-jordi'],
    });
    expect(
      await runProjectScope(sql, {
        ...reach,
        run: { projectId: 'p-dev', startedBy: 'dispatch:p-dev' },
      }),
    ).toEqual({
      ownProject: true,
      reachedProjectIds: ['p-billing', 'p-jordi'],
    });
    expect(memberEditableProjects).not.toHaveBeenCalled();
    expect(memberReadableProjects).not.toHaveBeenCalled();
  });

  it('reads nothing for a starter that names nobody', async () => {
    expect(await onBilling('user:')).toEqual({
      ownProject: false,
      reachedProjectIds: [],
    });
  });
});
