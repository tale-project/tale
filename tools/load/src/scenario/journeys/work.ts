/**
 * Working journeys: filing tasks in the organization's shared project,
 * moving them across the board, commenting, assigning, editing; creating a
 * project now and then; adding contacts. Every task write is registered
 * with the realtime registry so the other users' tabs measure how long the
 * change takes to reach them.
 */

import {
  TASK_STATUSES,
  type TaskStatus,
  assignTask,
  commentOnTask,
  createTask,
  getTask,
  listProjectBoard,
  listTaskComments,
  moveTask,
  setTaskStatus,
  updateTask,
} from '../../api/tasks.ts';
import {
  createContact,
  createProject,
  listContacts,
} from '../../api/workspace.ts';
import { chance, intBetween, pick, pickWeighted } from '../../data/random.ts';
import {
  contactDraft,
  projectDraft,
  taskComment,
  taskDraft,
} from '../../data/work.ts';
import { hintRegistry } from '../registry.ts';
import { type VirtualUser, forget, remember } from '../user.ts';
import type { Journey } from './journey.ts';

/** Where a task moves next: mostly forward, sometimes back or cancelled. */
const NEXT_STATUS: Record<
  TaskStatus,
  readonly (readonly [TaskStatus, number])[]
> = {
  backlog: [
    ['todo', 6],
    ['in_progress', 3],
    ['cancelled', 1],
  ],
  todo: [
    ['in_progress', 7],
    ['backlog', 2],
    ['cancelled', 1],
  ],
  in_progress: [
    ['in_review', 5],
    ['done', 3],
    ['todo', 2],
  ],
  in_review: [
    ['done', 6],
    ['in_progress', 4],
  ],
  done: [
    ['in_progress', 1],
    ['todo', 1],
  ],
  cancelled: [['backlog', 1]],
};

function isStatus(value: string | undefined): value is TaskStatus {
  return (
    value !== undefined && (TASK_STATUSES as readonly string[]).includes(value)
  );
}

/** Run a task write and register it for hint-latency measurement. */
async function taskWrite<T extends { ok: boolean }>(
  vu: VirtualUser,
  taskId: string,
  write: () => Promise<T>,
): Promise<T> {
  const clickedAt = performance.now();
  const result = await write();
  if (result.ok) hintRegistry.registerWrite(vu.metrics, taskId, clickedAt);
  return result;
}

/** File a task in the shared project, sometimes assigned to oneself. */
export const fileTask: Journey = {
  name: 'tasks.create',
  eligible: (vu) => vu.seat?.org.projectId !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    const projectId = vu.seat?.org.projectId;
    if (projectId === null || projectId === undefined) return;
    vu.screen = 'board';
    vu.boardProjectId = projectId;
    const draft = taskDraft(vu.data, vu.random);
    await vu.pause('type');
    const clickedAt = performance.now();
    const created = await createTask(vu.api, orgId, {
      projectId,
      title: draft.title,
      ...(draft.description === undefined
        ? {}
        : { description: draft.description }),
      priority: draft.priority,
      ...(draft.labels.length > 0 ? { labels: draft.labels } : {}),
      ...(draft.dueDate === undefined ? {} : { dueDate: draft.dueDate }),
      ...(chance(vu.random, 0.3) && vu.userId !== undefined
        ? { assigneeType: 'user' as const, assigneeId: vu.userId }
        : {}),
      ...(chance(vu.random, 0.3) ? { status: 'todo' as const } : {}),
    });
    const taskId = created.body;
    if (taskId === undefined) return;
    hintRegistry.registerWrite(vu.metrics, taskId, clickedAt);
    vu.metrics.counter('tasks.created');
    remember(vu.memory().myTasks, taskId);
    await listProjectBoard(vu.api, orgId, projectId);
  },
};

/** Pick one of one's tasks off the board and work it. */
export const workTask: Journey = {
  name: 'tasks.work',
  eligible: (vu) => vu.seat?.org.projectId !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    const projectId = vu.seat?.org.projectId;
    if (projectId === null || projectId === undefined) return;
    vu.screen = 'board';
    vu.boardProjectId = projectId;
    const board = await listProjectBoard(vu.api, orgId, projectId);
    const tasks = board.body ?? [];
    const memory = vu.memory();
    const mine = new Set(memory.myTasks);
    // A plain member works the tasks they filed; an editor any task.
    const workable = tasks.filter(
      (task) =>
        vu.canEdit || mine.has(task.id) || task.assigneeId === vu.userId,
    );
    const task = pick(vu.random, workable.slice(0, 30));
    if (task === undefined) {
      await fileTask.run(vu);
      return;
    }
    await vu.pause('read');
    const detail = await getTask(vu.api, orgId, task.id);
    if (detail.status === 404) {
      forget(memory.myTasks, task.id);
      return;
    }
    await listTaskComments(vu.api, orgId, task.id);
    await vu.pause('read');
    const current = isStatus(task.status) ? task.status : 'backlog';
    const next = pickWeighted(vu.random, NEXT_STATUS[current]) ?? 'todo';
    if (chance(vu.random, 0.7)) {
      await taskWrite(vu, task.id, () =>
        moveTask(vu.api, orgId, task.id, next),
      );
    } else {
      await taskWrite(vu, task.id, () =>
        setTaskStatus(vu.api, orgId, task.id, next),
      );
    }
    await vu.pause('click');
    if (chance(vu.random, 0.4)) {
      await taskWrite(vu, task.id, () =>
        commentOnTask(vu.api, orgId, task.id, taskComment(vu.data, vu.random)),
      );
      await vu.pause('click');
    }
    if (chance(vu.random, 0.2) && vu.userId !== undefined) {
      const userId = vu.userId;
      await taskWrite(vu, task.id, () =>
        assignTask(vu.api, orgId, task.id, userId),
      );
      await vu.pause('click');
    }
    if (chance(vu.random, 0.25)) {
      const draft = taskDraft(vu.data, vu.random);
      await taskWrite(vu, task.id, () =>
        updateTask(vu.api, orgId, task.id, {
          priority: draft.priority,
          dueDate: draft.dueDate ?? null,
        }),
      );
    }
  },
};

/** Join a discussion on a task from the board. */
export const commentTask: Journey = {
  name: 'tasks.comment',
  eligible: (vu) => vu.seat?.org.projectId !== null,
  run: async (vu) => {
    const orgId = vu.orgId;
    const memory = vu.memory();
    const taskId =
      pick(vu.random, memory.myTasks) ??
      (vu.canEdit ? pick(vu.random, memory.boardTasks) : undefined);
    if (taskId === undefined) {
      await fileTask.run(vu);
      return;
    }
    vu.screen = 'board';
    const comments = await listTaskComments(vu.api, orgId, taskId);
    if (comments.status === 404) {
      forget(memory.myTasks, taskId);
      return;
    }
    await vu.pause('type');
    await taskWrite(vu, taskId, () =>
      commentOnTask(vu.api, orgId, taskId, taskComment(vu.data, vu.random)),
    );
  },
};

/** A new project (editors only, rarely: 30 a minute per user is the cap). */
export const newProject: Journey = {
  name: 'projects.create',
  eligible: (vu) => vu.canEdit,
  run: async (vu) => {
    vu.screen = 'other';
    await vu.pause('type');
    const created = await createProject(
      vu.api,
      vu.orgId,
      projectDraft(vu.data, vu.random),
    );
    if (created.body !== undefined) vu.metrics.counter('projects.created');
  },
};

/** Add a contact (editors) and look it up again. */
export const addContact: Journey = {
  name: 'contacts.create',
  eligible: (vu) => vu.canEdit,
  run: async (vu) => {
    vu.screen = 'other';
    await vu.pause('type');
    const suffix = `${vu.ctx.plan.runId}${vu.index}x${intBetween(vu.random, 0, 1_000_000)}`;
    const draft = contactDraft(vu.data, vu.random, suffix);
    const created = await createContact(vu.api, vu.orgId, draft);
    if (created.body !== undefined) vu.metrics.counter('contacts.created');
    await vu.pause('click');
    await listContacts(vu.api, vu.orgId, { search: draft.name.split(' ')[0] });
  },
};
