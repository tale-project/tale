import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import {
  externalTaskStatusBodySchema,
  projectExternalTaskStatus,
  readTaskStatusSnapshot,
  requestExternalTaskStatus,
  type ExternalTaskStatusInput,
} from './external-status.ts';
import { hasPendingAgentReviewForTask } from './reviews.ts';
import {
  applyExternalTaskStatusProjection,
  assertTaskWorkable,
  type TaskRow,
} from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow: vi.fn(),
}));
vi.mock('./reviews.ts', async (original) => ({
  ...(await original<typeof import('./reviews.ts')>()),
  hasPendingAgentReviewForTask: vi.fn(),
}));
vi.mock('./service.ts', async (original) => ({
  ...(await original<typeof import('./service.ts')>()),
  applyExternalTaskStatusProjection: vi.fn(),
  assertTaskWorkable: vi.fn(),
}));

const auth = {
  organizationId: 'org-1',
  userId: 'mirror',
  role: 'editor',
  teamIds: [],
};
const input: ExternalTaskStatusInput = {
  externalSystem: 'quality-source',
  externalId: 'item:7',
  expectedRevision: '41',
  sourceRevision: 'source-v2',
  sourceStatusAt: 100,
  status: 'done',
  archived: false,
};

function database() {
  const task = {
    id: 'task-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    title: 'Fix the machine',
    status: 'in_review',
    archivedAt: null,
    externalSystem: 'quality-source',
    externalId: 'item:7',
    externalIssue: null,
  } as TaskRow;
  const view = {
    id: task.id,
    status: task.status,
    archivedAt: task.archivedAt,
    externalSystem: task.externalSystem,
    externalId: task.externalId,
    statusChangedAt: 90,
    revisionId: '41',
    changeId: '41',
    action: 'status.changed',
    changeAt: 90,
    actorType: 'user',
    actorId: 'person-1',
    context: null as unknown,
    actorEmail: 'person@example.com',
    emailVerified: true,
    activeMember: true,
    sourceRevision: null as string | null,
    sourceStatusAt: null as number | null,
    sourceStatus: null as string | null,
    sourceArchived: null as boolean | null,
    workflow: null as unknown,
    requestId: null,
  };
  const queries: { text: string; values: unknown[] }[] = [];
  let appliedRevision = '0';
  const requestLedger: { decision?: unknown } = {};
  const tx = Object.assign(
    (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join('?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values });
      if (text.includes('FROM app.tasks t'))
        return Promise.resolve([{ ...view }]);
      if (text.includes('FROM app.tasks'))
        return Promise.resolve([{ ...task }]);
      if (text.includes('SELECT applied_revision'))
        return Promise.resolve([{ revision: appliedRevision }]);
      if (
        text.includes('SELECT decision FROM app.task_external_status_requests')
      )
        return Promise.resolve(
          requestLedger.decision === undefined
            ? []
            : [{ decision: requestLedger.decision }],
        );
      if (text.startsWith('INSERT INTO app.task_external_status')) {
        view.sourceRevision = String(values[4]);
        view.sourceStatusAt = Number(values[5]);
        view.sourceStatus = String(values[6]);
        view.sourceArchived = Boolean(values[7]);
        appliedRevision = String(values[8]);
      }
      return Promise.resolve([]);
    },
    { unsafe: (text: string) => text, json: (value: unknown) => value },
  ) as unknown as TransactionSql;
  vi.mocked(applyExternalTaskStatusProjection).mockImplementation(
    async (_tx, args) => {
      task.status = args.status;
      task.archivedAt = args.archived ? 101 : null;
      view.status = task.status;
      view.archivedAt = task.archivedAt;
      view.changeId = String(BigInt(view.changeId) + 1n);
      view.revisionId = view.changeId;
      view.context = args.context;
      view.actorType = 'agent';
      view.actorId = args.actorId;
    },
  );
  const project = (overrides: Partial<ExternalTaskStatusInput> = {}) =>
    projectExternalTaskStatus(tx, auth, {
      projectId: 'project-1',
      taskId: task.id,
      input: { ...input, ...overrides },
    });
  return { task, view, tx, queries, project, requestLedger };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadProjectOrThrow).mockResolvedValue({
    id: 'project-1',
    organizationId: 'org-1',
    archivedAt: null,
  } as Awaited<ReturnType<typeof loadProjectOrThrow>>);
  vi.mocked(assertTaskWorkable).mockResolvedValue();
  vi.mocked(hasPendingAgentReviewForTask).mockResolvedValue(false);
});

describe('trusted native source transition boundary', () => {
  it('requires a currently verified native member before capturing source intent [TASK-R19]', async () => {
    const db = database();
    await expect(
      requestExternalTaskStatus(db.tx, auth, db.task.id, {
        requestId: '00000000-0000-4000-8000-000000000001',
        expectedRevision: '41',
        expectedSourceRevision: 'source-v2',
        actionId: 'verify',
        values: { note: 'Evidence from the person' },
      }),
    ).rejects.toMatchObject({ code: 'TASK_FORBIDDEN', status: 403 });
    expect(db.queries.some((query) => query.text.startsWith('INSERT'))).toBe(
      false,
    );
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses source settlement of an unknown immutable request [TASK-R20]', async () => {
    const db = database();
    await expect(
      db.project({
        requestId: '00000000-0000-4000-8000-000000000001',
        decision: { accepted: true },
      }),
    ).rejects.toMatchObject({ code: 'TASK_STATUS_CONFLICT', status: 409 });
    expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
  });

  it('never contradicts a durable source decision on replay [TASK-R20]', async () => {
    const db = database();
    db.requestLedger.decision = {
      accepted: false,
      reason: 'The source owner did not authorize this transition',
    };
    await expect(
      db.project({
        requestId: '00000000-0000-4000-8000-000000000001',
        decision: { accepted: true },
      }),
    ).rejects.toMatchObject({ code: 'TASK_STATUS_CONFLICT', status: 409 });
    expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
    expect(db.requestLedger.decision).toEqual({
      accepted: false,
      reason: 'The source owner did not authorize this transition',
    });
  });
});

describe('accepted external task status [TASK-R14]', () => {
  it.each([
    { externalId: 'item:other' },
    { externalSystem: 'other-source' },
    { externalSystem: 'github' },
    { externalSystem: 'GLITCHTIP' },
  ])(
    'refuses a mismatched or reserved source without writing %j',
    async (external) => {
      const db = database();
      if (['github', 'GLITCHTIP'].includes(external.externalSystem ?? ''))
        db.task.externalSystem = external.externalSystem!;
      await expect(db.project(external)).rejects.toMatchObject({
        code: 'TASK_EXTERNAL_REF_INVALID',
      });
      expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
    },
  );

  it('rechecks task work permission before the source claims authority', async () => {
    const db = database();
    vi.mocked(assertTaskWorkable).mockRejectedValue(new Error('not allowed'));
    await expect(db.project()).rejects.toThrow('not allowed');
    expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
  });

  it('rejects forged native actor/review claims at the strict body boundary', () => {
    expect(
      externalTaskStatusBodySchema.safeParse({
        ...input,
        actor: { email: 'someone@example.com' },
      }).success,
    ).toBe(false);
    expect(
      externalTaskStatusBodySchema.safeParse({ ...input, decision: 'approve' })
        .success,
    ).toBe(false);
  });
});

describe('source approval is separate evidence [TASK-R15]', () => {
  it('projects completion as external evidence attributed to the key', async () => {
    const db = database();
    const result = await db.project();
    expect(result.task.status).toBe('done');
    expect(result.change?.origin).toBe('external');
    expect(result.externalStatus?.sourceRevision).toBe('source-v2');
    expect(createAuditLog).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({
        actorType: 'api',
        action: 'task.external_status_projected',
      }),
    );
  });

  it('cannot supersede a pending native agent review', async () => {
    const db = database();
    vi.mocked(hasPendingAgentReviewForTask).mockResolvedValue(true);
    await expect(db.project()).rejects.toMatchObject({
      code: 'TASK_AGENT_REVIEW_REQUIRED',
    });
    expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
  });
});

describe('native lifecycle ordering [TASK-R16]', () => {
  it('refuses an older native revision', async () => {
    const db = database();
    await expect(db.project({ expectedRevision: '40' })).rejects.toMatchObject({
      code: 'TASK_STATUS_CONFLICT',
    });
    expect(applyExternalTaskStatusProjection).not.toHaveBeenCalled();
  });

  it('replays a lost reply without a second lifecycle write', async () => {
    const db = database();
    const first = await db.project();
    const replay = await db.project();
    expect(replay.revision).toBe(first.revision);
    expect(applyExternalTaskStatusProjection).toHaveBeenCalledTimes(1);
  });

  it('a later native move back to the same column still refuses old replay', async () => {
    const db = database();
    await db.project();
    db.view.changeId = '44';
    db.view.revisionId = '44';
    db.view.context = null;
    db.view.actorType = 'user';
    await expect(db.project()).rejects.toMatchObject({
      code: 'TASK_STATUS_CONFLICT',
    });
    expect(applyExternalTaskStatusProjection).toHaveBeenCalledTimes(1);
    const restored = await db.project({ expectedRevision: '44' });
    expect(restored.change?.origin).toBe('external');
  });
});

describe('source lifecycle ordering [TASK-R17]', () => {
  it('rejects an older source observation even with the fresh native revision', async () => {
    const db = database();
    const first = await db.project();
    await expect(
      db.project({ sourceStatusAt: 99, expectedRevision: first.revision }),
    ).rejects.toMatchObject({ code: 'TASK_EXTERNAL_STATUS_STALE' });
  });

  it('allows same-time content refresh but refuses same-time conflicting lifecycle', async () => {
    const db = database();
    const first = await db.project();
    const refreshed = await db.project({
      sourceRevision: 'source-content-v3',
      expectedRevision: first.revision,
    });
    expect(refreshed.externalStatus?.sourceRevision).toBe('source-content-v3');
    await expect(
      db.project({
        sourceRevision: 'source-content-v4',
        expectedRevision: refreshed.revision,
        archived: true,
      }),
    ).rejects.toMatchObject({ code: 'TASK_EXTERNAL_STATUS_STALE' });
  });
});

describe('native actor provenance [TASK-R18]', () => {
  it('a later archive revision preserves the current status actor', async () => {
    const db = database();
    db.view.revisionId = '42';
    const state = await readTaskStatusSnapshot(db.tx, 'org-1', 'task-1');
    expect(state.revision).toBe('42');
    expect(state.change?.id).toBe('41');
    expect(state.change?.actor.userId).toBe('person-1');
  });
  it.each([
    { emailVerified: false },
    { activeMember: false },
    { actorType: 'agent', actorEmail: null },
  ])(
    'does not relay an address that is not actively verified %j',
    async (change) => {
      const db = database();
      Object.assign(db.view, change);
      const state = await readTaskStatusSnapshot(db.tx, 'org-1', 'task-1');
      expect(state.change?.actor.email).toBeUndefined();
      expect(db.queries[0]?.values).toEqual(['task-1', 'org-1']);
    },
  );

  it('reads the native person id and verified email together', async () => {
    const db = database();
    const state = await readTaskStatusSnapshot(db.tx, 'org-1', 'task-1');
    expect(state.change).toMatchObject({
      origin: 'native',
      actor: {
        userId: 'person-1',
        email: 'person@example.com',
        emailVerified: true,
        activeMember: true,
      },
    });
  });
});
