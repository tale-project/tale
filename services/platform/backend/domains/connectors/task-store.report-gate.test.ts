import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeActorRun } from '../automations/dispatch-store.ts';
import { getRun } from '../automations/store.ts';
import {
  getProjectAuthContext,
  loadProjectOrThrow,
} from '../projects/service.ts';
import { reportDispatchGate } from '../tasks/dispatch-gates.ts';
import { TaskError } from '../tasks/service.ts';
import { pgTaskStore } from './task-store.ts';

vi.mock('../automations/dispatch-store.ts', () => ({
  authorizeActorRun: vi.fn(),
}));
// The run's binding is read for real (`resolveRunProject`), from the
// installations and the project row the transaction answers below.
vi.mock('../automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../automations/store.ts')>()),
  getRun: vi.fn(),
}));
// The edit bar is the real one (`assertWritable`).
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow: vi.fn(),
  getProjectAuthContext: vi.fn(),
}));
vi.mock('../tasks/dispatch-gates.ts', () => ({
  reportDispatchGate: vi.fn(),
}));

/** The projects the automation is installed in. */
let installedIn: string[];
/** When the project was archived, or null. */
let archivedAt: number | null;
const tx = vi.fn((strings: TemplateStringsArray) => {
  const text = strings.join('?');
  if (text.includes('FROM app.automation_project_bindings')) {
    return Promise.resolve(installedIn.map((projectId) => ({ projectId })));
  }
  if (text.includes('FROM app.projects')) {
    return Promise.resolve([{ id: 'project-1', archivedAt }]);
  }
  return Promise.resolve([]);
});
const sql = {
  begin: async (_mode: string, work: (transaction: unknown) => unknown) =>
    work(tx),
} as unknown as Sql;

const project = {
  id: 'project-1',
  organizationId: 'org-1',
  archivedAt: null,
  teamId: null,
  sharedWithTeamIds: [],
  teamIds: [],
};
const person = (role: string) => ({
  organizationId: 'org-1',
  userId: 'user-1',
  role,
  teamIds: [],
});
const system = { organizationId: 'org-1', userId: 'system', role: 'owner' };
const ask = {
  organizationId: 'org-1',
  runId: 'run-1',
  projectId: 'project-1',
  key: 'ci',
  report: { value: 12, reason: '12 workflow runs queued' },
};

const startedBy = (starter: string) =>
  vi.mocked(getRun).mockResolvedValue({
    name: 'fleet/ci-queue',
    projectId: null,
    startedBy: starter,
  } as never);

beforeEach(() => {
  vi.resetAllMocks();
  installedIn = ['project-1'];
  archivedAt = null;
  vi.mocked(loadProjectOrThrow).mockResolvedValue(project as never);
  vi.mocked(getProjectAuthContext).mockResolvedValue(system as never);
  vi.mocked(authorizeActorRun).mockResolvedValue(person('editor') as never);
  vi.mocked(reportDispatchGate).mockResolvedValue({
    held: true,
    changed: true,
  });
  startedBy('trigger:trigger-1');
});

describe('an automation step reports on a gate of its project [TASK-R51]', () => {
  it('records a scheduled run’s report as its installation, naming the run [TASK-R51]', async () => {
    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toEqual({
      ok: true,
      held: true,
      changed: true,
      reportedBy: 'run:run-1',
    });
    expect(authorizeActorRun).not.toHaveBeenCalled();
    expect(reportDispatchGate).toHaveBeenCalledWith(tx, system, {
      projectId: 'project-1',
      key: 'ci',
      report: { value: 12, reason: '12 workflow runs queued' },
      reporter: 'run:run-1',
      access: 'checked',
    });
  });

  it.each(['user:user-1', 'api-key:user-1'])(
    'records the report of a run %s started within that person’s rights, who may edit the project',
    async (starter) => {
      startedBy(starter);
      const editor = person('editor');
      vi.mocked(authorizeActorRun).mockResolvedValue(editor as never);

      const answer = await pgTaskStore(sql).reportGate(ask);

      expect(answer.ok).toBe(true);
      expect(authorizeActorRun).toHaveBeenCalledWith(
        tx,
        'org-1',
        'user-1',
        'membership',
      );
      expect(vi.mocked(reportDispatchGate).mock.calls[0]?.[1]).toBe(editor);
    },
  );

  it('refuses a run a reader of the project started — reporting is an editor’s, as at the API', async () => {
    startedBy('user:user-1');
    vi.mocked(authorizeActorRun).mockResolvedValue(person('member') as never);

    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toEqual({
      ok: false,
      refusal: {
        kind: 'project',
        code: 'RBAC_FORBIDDEN',
        detail: 'The person who started the run may not edit the project.',
      },
    });
    expect(reportDispatchGate).not.toHaveBeenCalled();
  });

  it('refuses a project the automation is not installed in', async () => {
    installedIn = ['project-2'];

    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toMatchObject({
      ok: false,
      refusal: { kind: 'project', code: 'AUTOMATION_PROJECT_FORBIDDEN' },
    });
    expect(reportDispatchGate).not.toHaveBeenCalled();
  });

  it('refuses a project the automation is installed in once it is archived', async () => {
    archivedAt = 1_790_000_000_000;

    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toMatchObject({
      ok: false,
      refusal: { kind: 'project', code: 'PROJECT_ARCHIVED' },
    });
    expect(reportDispatchGate).not.toHaveBeenCalled();
  });

  it('refuses a project of another organization as one that does not exist', async () => {
    vi.mocked(loadProjectOrThrow).mockResolvedValue({
      ...project,
      organizationId: 'org-2',
    } as never);

    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toEqual({
      ok: false,
      refusal: {
        kind: 'project',
        code: 'PROJECT_NOT_FOUND',
        detail: 'Project not found',
      },
    });
    expect(getRun).not.toHaveBeenCalled();
  });

  it('refuses a run scoped to another project', async () => {
    vi.mocked(getRun).mockResolvedValue({
      name: 'fleet/ci-queue',
      projectId: 'project-2',
      startedBy: 'trigger:trigger-1',
    } as never);

    const answer = await pgTaskStore(sql).reportGate(ask);

    expect(answer).toMatchObject({
      ok: false,
      refusal: { kind: 'project', detail: 'The run works in another project.' },
    });
    expect(reportDispatchGate).not.toHaveBeenCalled();
  });

  it.each(['dispatch:project-1', ''])(
    'refuses a run that answers to nobody who may report (%j)',
    async (starter) => {
      startedBy(starter);

      const answer = await pgTaskStore(sql).reportGate(ask);

      expect(answer).toMatchObject({
        ok: false,
        refusal: { kind: 'project', code: 'PROJECT_FORBIDDEN' },
      });
      expect(authorizeActorRun).not.toHaveBeenCalled();
      expect(reportDispatchGate).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'DISPATCH_GATE_UNKNOWN',
      "The project's dispatch declares no gate of that key.",
      404,
    ],
    [
      'DISPATCH_GATE_VALUE_UNJUDGED',
      'This gate judges no values: report a state, or give the gate a holdAt.',
      400,
    ],
  ] as const)(
    'answers the writer’s %s as a refusal of the gate',
    async (code, detail, status) => {
      vi.mocked(reportDispatchGate).mockRejectedValue(
        new TaskError(code, detail, status),
      );

      const answer = await pgTaskStore(sql).reportGate(ask);

      expect(answer).toEqual({
        ok: false,
        refusal: { kind: 'gate', code, detail },
      });
    },
  );

  it('passes a failure of the database on as it is', async () => {
    const lost = new Error('connection terminated');
    vi.mocked(reportDispatchGate).mockRejectedValue(lost);

    await expect(pgTaskStore(sql).reportGate(ask)).rejects.toBe(lost);
  });
});
