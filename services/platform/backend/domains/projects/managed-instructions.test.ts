// @vitest-environment node

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { resolveSurfaceMentions } from '../collab/mention-directory.ts';
import { notifyTaskMentions } from '../collab/service.ts';
import {
  readTaskInstructionsConfiguration,
  updateTaskInstructionsConfiguration,
} from '../tasks/service.ts';
import {
  readProjectInstructionsConfiguration,
  readAgentInstructionsConfiguration,
  updateProjectInstructions,
  updateAgentInstructionsConfiguration,
} from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../collab/mention-directory.ts', () => ({
  resolveSurfaceMentions: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  autoSubscribe: vi.fn(),
  notifyTaskAssigned: vi.fn(),
  notifyTaskMentions: vi.fn(),
  notifyTaskReviewerAssigned: vi.fn(),
  notifyTaskStatusChanged: vi.fn(),
  dismissReviewerAssignedNotifications: vi.fn(),
}));

const auth = {
  organizationId: 'org-a',
  userId: 'editor-a',
  role: 'admin',
  teamIds: [] as string[],
};
const project = {
  id: 'project-a',
  organizationId: 'org-a',
  name: 'Review project',
  instructions: 'old project',
  teamId: null,
  teamIds: [],
  sharedWithTeamIds: [],
  archivedAt: null,
};
const agent = {
  id: 'agent-a',
  organizationId: 'org-a',
  projectId: 'project-a',
  instructions: 'old agent',
  managed: false,
  model: 'test-model',
  modelProvider: 'test-provider',
  harness: 'codex',
  skills: ['skill-a'],
  connectors: ['connector-a'],
  tools: ['tool-a'],
  secrets: ['PRIVATE_TOKEN'],
  updatedAt: 1,
};
const task = {
  id: 'task-a',
  organizationId: 'org-a',
  projectId: 'project-a',
  title: 'Standing review',
  description: 'old task',
  archivedAt: null,
  status: 'in_progress',
  priority: 'p1',
  labelIds: ['label-a'],
  startDate: null,
  dueDate: null,
  reviewerUserId: null,
  reviewerAgentId: 'reviewer-a',
  assigneeType: 'agent',
  assigneeId: 'agent-a',
  attachments: [{ fileId: 'attachment-a' }],
  repeat: null,
  parentTaskId: null,
  createdBy: 'creator-a',
  createdByType: 'user',
  number: 1,
};

type Statement = { text: string; values: unknown[] };
function database(
  overrides: {
    project?: Partial<typeof project>;
    agent?: Partial<typeof agent>;
    task?: Partial<typeof task>;
  } = {},
) {
  const p = { ...project, ...overrides.project };
  const a = { ...agent, ...overrides.agent };
  const t = { ...task, ...overrides.task };
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?'))
      return Promise.resolve(values.includes(p.id) ? [p] : []);
    if (text.includes('FROM app.project_agents WHERE id = ?'))
      return Promise.resolve(
        values.includes(a.id) &&
          values.includes(a.projectId) &&
          values.includes(a.organizationId)
          ? [a]
          : [],
      );
    if (text.includes('FROM app.tasks WHERE id = ?'))
      return Promise.resolve(
        values.includes(t.id) && values.includes(t.organizationId) ? [t] : [],
      );
    if (text.startsWith('INSERT INTO app.task_activity'))
      return Promise.resolve([{ id: 'activity-a' }]);
    return Promise.resolve([]);
  };
  const tx = Object.assign(tag, {
    unsafe: (s: string) => s,
    json: (value: unknown) => value,
  }) as unknown as TransactionSql;
  return {
    tx,
    statements,
    writes: () =>
      statements.filter(({ text }) => /^(UPDATE|INSERT|DELETE)/.test(text)),
  };
}
const config = {
  project: { projectId: project.id, instructions: project.instructions },
  agent: {
    projectId: project.id,
    agentId: agent.id,
    instructions: agent.instructions,
  },
  task: {
    projectId: project.id,
    taskId: task.id,
    description: task.description,
  },
};
function hash(value: unknown) {
  return managedConfigurationHash(value)!;
}

beforeEach(() => vi.clearAllMocks());

describe('managed instruction adoption and preconditions', () => {
  it('stores mention text without starting agents or dispatching notifications', async () => {
    const db = database();
    await updateTaskInstructionsConfiguration(
      db.tx,
      auth,
      { ...config.task, description: 'Coordinate with @agent-a and @owner.' },
      hash(config.task),
    );
    expect(resolveSurfaceMentions).not.toHaveBeenCalled();
    expect(notifyTaskMentions).not.toHaveBeenCalled();
    expect(
      db
        .writes()
        .some(({ text }) =>
          /agent_runs|job|notifications|assignee_id =/.test(text),
        ),
    ).toBe(false);
    expect(createAuditLog).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({
        newState: { description: 'Coordinate with @agent-a and @owner.' },
      }),
    );
  });
  it('reads only scoped owned text and hashes it, without equipment or live task fields', async () => {
    const { tx } = database();
    expect(
      await readProjectInstructionsConfiguration(tx, auth, project.id),
    ).toEqual({ config: config.project, hash: hash(config.project) });
    expect(
      await readAgentInstructionsConfiguration(tx, auth, project.id, agent.id),
    ).toEqual({ config: config.agent, hash: hash(config.agent) });
    expect(
      await readTaskInstructionsConfiguration(tx, auth, project.id, task.id),
    ).toEqual({ config: config.task, hash: hash(config.task) });
  });

  it('refuses stale writes before touching records, audit or realtime', async () => {
    const db = database();
    for (const run of [
      () =>
        updateProjectInstructions(
          db.tx,
          auth,
          project.id,
          'new',
          '0'.repeat(64),
        ),
      () =>
        updateAgentInstructionsConfiguration(
          db.tx,
          auth,
          { ...config.agent, instructions: 'new' },
          '0'.repeat(64),
        ),
      () =>
        updateTaskInstructionsConfiguration(
          db.tx,
          auth,
          { ...config.task, description: 'new' },
          '0'.repeat(64),
        ),
    ])
      await expect(run()).rejects.toMatchObject({
        code: 'CONFIG_VERSION_CONFLICT',
        status: 409,
      });
    expect(db.writes()).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('does not hide stale review by treating equal desired text as success', async () => {
    const db = database();
    await expect(
      updateProjectInstructions(
        db.tx,
        auth,
        project.id,
        project.instructions,
        '0'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    await expect(
      updateAgentInstructionsConfiguration(
        db.tx,
        auth,
        config.agent,
        '0'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    await expect(
      updateTaskInstructionsConfiguration(
        db.tx,
        auth,
        config.task,
        '0'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' });
    expect(db.writes()).toEqual([]);
  });

  it('leaves equal instructions, timestamps, audit, hints and active work untouched', async () => {
    const db = database();
    await updateProjectInstructions(
      db.tx,
      auth,
      project.id,
      project.instructions,
      hash(config.project),
    );
    await updateAgentInstructionsConfiguration(
      db.tx,
      auth,
      { ...config.agent, instructions: ` ${agent.instructions} ` },
      hash(config.agent),
    );
    await updateTaskInstructionsConfiguration(
      db.tx,
      auth,
      config.task,
      hash(config.task),
    );
    expect(db.writes()).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('updates only agent instructions and timestamp, preserving grants and serving configuration', async () => {
    const db = database();
    await updateAgentInstructionsConfiguration(
      db.tx,
      auth,
      { ...config.agent, instructions: ' new agent ' },
      hash(config.agent),
    );
    expect(db.writes()).toHaveLength(1);
    expect(db.writes()[0]!.text).toMatch(
      /^UPDATE app.project_agents SET instructions = \?, updated_at_ms = \? WHERE id = \? AND project_id = \? AND org_id = \?$/,
    );
    expect(db.writes()[0]!.values).toEqual([
      'new agent',
      expect.any(Number),
      agent.id,
      project.id,
      auth.organizationId,
    ]);
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(emitHintInTx).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(createAuditLog).mock.calls)).not.toContain(
      'PRIVATE_TOKEN',
    );
  });

  it('uses the ordinary task edit audit/activity with no state, owner, review or attachment change', async () => {
    const db = database();
    await updateTaskInstructionsConfiguration(
      db.tx,
      auth,
      { ...config.task, description: ' new task\n' },
      hash(config.task),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({
        previousState: { description: 'old task' },
        newState: { description: ' new task\n' },
      }),
    );
    const update = db
      .writes()
      .find(({ text }) => text.startsWith('UPDATE app.tasks'))!;
    expect(update.values[0]).toBe(task.title);
    expect(update.values[1]).toBe(' new task\n');
    expect(update.values[2]).toBe(task.priority);
    expect(update.values[3]).toEqual(task.labelIds);
    expect(update.text).not.toMatch(
      /SET status|assignee_id =|reviewer_agent_id =/,
    );
    expect(update.values.slice(6, 13)).toEqual([
      false,
      false,
      false,
      false,
      null,
      false,
      null,
    ]);
    expect(
      db
        .writes()
        .filter(({ text }) => text.startsWith('INSERT INTO app.task_activity')),
    ).toHaveLength(1);
  });

  it('preserves whitespace in project text and emits native audit plus hint', async () => {
    const db = database();
    await updateProjectInstructions(
      db.tx,
      auth,
      project.id,
      ' new project\n',
      hash(config.project),
    );
    expect(db.writes()[0]!.values[0]).toBe(' new project\n');
    expect(createAuditLog).toHaveBeenCalledOnce();
    expect(emitHintInTx).toHaveBeenCalledOnce();
  });

  it('returns opaque missing before revealing a foreign project hash', async () => {
    const db = database();
    const foreign = { ...auth, organizationId: 'org-b' };
    for (const run of [
      () => readProjectInstructionsConfiguration(db.tx, foreign, project.id),
      () =>
        readAgentInstructionsConfiguration(
          db.tx,
          foreign,
          project.id,
          agent.id,
        ),
      () =>
        readTaskInstructionsConfiguration(db.tx, foreign, project.id, task.id),
      () =>
        updateProjectInstructions(
          db.tx,
          foreign,
          project.id,
          'new',
          hash(config.project),
        ),
      () =>
        updateAgentInstructionsConfiguration(
          db.tx,
          foreign,
          config.agent,
          hash(config.agent),
        ),
      () =>
        updateTaskInstructionsConfiguration(
          db.tx,
          foreign,
          config.task,
          hash(config.task),
        ),
    ])
      await expect(run()).rejects.toMatchObject({ status: 404 });
    expect(db.writes()).toEqual([]);
  });

  it('refuses adoption of an agent or task outside the declared project', async () => {
    const db = database();
    await expect(
      readAgentInstructionsConfiguration(db.tx, auth, project.id, 'missing'),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      readTaskInstructionsConfiguration(db.tx, auth, 'other-project', task.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateTaskInstructionsConfiguration(
        db.tx,
        auth,
        { ...config.task, projectId: 'other-project' },
        hash(config.task),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(db.writes()).toEqual([]);
  });

  it('keeps member read rights without granting instruction writes to others tasks', async () => {
    const db = database();
    const reader = { ...auth, role: 'member' };
    await expect(
      readProjectInstructionsConfiguration(db.tx, reader, project.id),
    ).resolves.toMatchObject({ config: config.project });
    for (const run of [
      () =>
        updateProjectInstructions(
          db.tx,
          reader,
          project.id,
          'new',
          hash(config.project),
        ),
      () =>
        updateAgentInstructionsConfiguration(
          db.tx,
          reader,
          config.agent,
          hash(config.agent),
        ),
      () =>
        updateTaskInstructionsConfiguration(
          db.tx,
          reader,
          config.task,
          hash(config.task),
        ),
    ])
      await expect(run()).rejects.toMatchObject({
        code: 'RBAC_FORBIDDEN',
        status: 403,
      });
    expect(db.writes()).toEqual([]);
  });

  it('preserves managed-agent and archive refusals even on otherwise equal writes', async () => {
    const managed = database({ agent: { managed: true } });
    await expect(
      updateAgentInstructionsConfiguration(
        managed.tx,
        auth,
        config.agent,
        hash(config.agent),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_AGENT_MANAGED' });
    const archived = database({ project: { archivedAt: 1 as never } });
    await expect(
      updateProjectInstructions(
        archived.tx,
        auth,
        project.id,
        project.instructions,
        hash(config.project),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    await expect(
      updateAgentInstructionsConfiguration(
        archived.tx,
        auth,
        config.agent,
        hash(config.agent),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    const archivedTask = database({ task: { archivedAt: 1 as never } });
    await expect(
      updateTaskInstructionsConfiguration(
        archivedTask.tx,
        auth,
        config.task,
        hash(config.task),
      ),
    ).rejects.toMatchObject({ code: 'TASK_ARCHIVED' });
    expect([
      ...managed.writes(),
      ...archived.writes(),
      ...archivedTask.writes(),
    ]).toEqual([]);
  });
});
