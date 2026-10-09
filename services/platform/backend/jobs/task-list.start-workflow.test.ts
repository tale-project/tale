import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The start an @automation comment queued: a comment written with an API key
 * starts the run through the key's door, the key booked beside the person
 * (SBX-R14); one written without a key starts it as the person's own.
 */

const { startWorkflowForTask, loadTaskForWorkflowStart } = vi.hoisted(() => ({
  startWorkflowForTask: vi.fn(async () => ({
    runId: 'run-1',
    alreadyRunning: false,
  })),
  loadTaskForWorkflowStart: vi.fn(async () => ({
    id: 'task-1',
    title: 'Triage the inbox',
    status: 'todo',
    projectId: 'project-1',
    externalSystem: null,
    externalId: null,
    externalUrl: null,
  })),
}));
vi.mock('../domains/tasks/external-ref.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/tasks/external-ref.ts')
  >()),
  startWorkflowForTask,
}));
vi.mock('../domains/tasks/comments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/tasks/comments.ts')>()),
  loadTaskForWorkflowStart,
}));

import { createTaskList } from './task-list.ts';

const PAYLOAD = {
  organizationId: 'org-1',
  taskId: 'task-1',
  workflowSlug: 'triage',
  startedByUserId: 'user-1',
};

function start(payload: Record<string, unknown>) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler hands the pool to the mocked start alone
  const handler = createTaskList({ sql: {} as Sql })['task.start_workflow'];
  if (handler === undefined)
    throw new Error('task.start_workflow is not wired');
  return handler(payload);
}

beforeEach(() => startWorkflowForTask.mockClear());

describe('task.start_workflow', () => {
  it('starts a keyed comment’s run through the key’s door [SBX-R14]', async () => {
    await start({ ...PAYLOAD, apiKeyId: 'key-1' });

    expect(startWorkflowForTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startedByUserId: 'user-1',
        startedVia: 'api-key',
        apiKeyId: 'key-1',
      }),
    );
  });

  it('starts a comment written without a key as the person’s own', async () => {
    await start(PAYLOAD);

    expect(startWorkflowForTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ startedVia: 'api-key' }),
    );
    expect(startWorkflowForTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ apiKeyId: expect.anything() }),
    );
  });
});
