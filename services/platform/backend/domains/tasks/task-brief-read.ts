import type { Sql } from 'postgres';

import type { TaskBriefFacts } from '../../../lib/agent/task-brief.ts';
import { cutTaskText, relabelTaskMentions } from '../../core/tasks/mentions.ts';
import { currentMentionNames } from '../collab/mention-directory.ts';

/**
 * What an agent turn is told about the task it works on, read from the
 * task as it stands now: the facts the brief states (`lib/agent/task-brief.ts`
 * words them), the files the task holds, and the discussion with its times.
 * One reader for both engines a run can execute on — the harness stages the
 * files on a disk and a native turn names them by ref, but both read them
 * from here.
 */

/** A file a task holds, as its `attachments` and `outputs` columns keep it. */
export interface TaskBriefFile {
  fileId: string;
  fileName: string;
}

export interface TaskBriefRead extends TaskBriefFacts {
  /** The task's discussion tail, oldest first, with when each was posted. */
  discussion: Array<{ author: 'user' | 'agent'; body: string; at: number }>;
  /** What the task's people attached. */
  attachments: TaskBriefFile[];
  /** The deliverables earlier runs produced, oldest first. */
  outputs: TaskBriefFile[];
}

/** Comments of the discussion a brief carries: the newest. */
const BRIEF_DISCUSSION_LIMIT = 10;
/** Characters of one comment a brief carries. */
const BRIEF_COMMENT_MAX_CHARS = 2000;

function fileList(value: unknown): TaskBriefFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is { fileId: unknown; fileName: unknown } =>
        entry !== null && typeof entry === 'object',
    )
    .map((entry) => ({
      fileId: typeof entry.fileId === 'string' ? entry.fileId : '',
      fileName: typeof entry.fileName === 'string' ? entry.fileName : '',
    }))
    .filter((entry) => entry.fileId !== '' && entry.fileName !== '');
}

/** The brief of a task, or `null` when the task is gone. */
export async function readTaskBrief(
  sql: Sql,
  taskId: string,
): Promise<TaskBriefRead | null> {
  const tasks = await sql<
    {
      title: string;
      description: string | null;
      labelIds: string[];
      number: number | null;
      projectId: string;
      attachments: unknown;
      outputs: unknown;
      organizationId: string;
    }[]
  >`
    SELECT title, description, label_ids AS "labelIds", number,
           project_id AS "projectId", attachments, outputs,
           org_id AS "organizationId"
    FROM app.tasks WHERE id = ${taskId} LIMIT 1
  `;
  const task = tasks[0];
  if (!task) return null;
  const projects = await sql<{ name: string; key: string | null }[]>`
    SELECT name, key FROM app.projects
    WHERE id = ${task.projectId} LIMIT 1
  `;
  const project = projects[0];
  const identifier =
    project?.key != null && task.number !== null
      ? `${project.key}-${task.number}`
      : undefined;
  const discussion = await sql<
    { authorType: string; body: string; createdAt: number }[]
  >`
    SELECT * FROM (
      SELECT meta.author_type AS "authorType",
             coalesce(m.text, '') AS body,
             m.created_at_ms::float8 AS "createdAt"
      FROM app.task_discussion_message_meta meta
      JOIN app.messages m ON m.id = meta.message_id
      WHERE meta.task_id = ${taskId}
      ORDER BY m.created_at_ms DESC
      LIMIT ${BRIEF_DISCUSSION_LIMIT}
    ) tail ORDER BY "createdAt"
  `;
  const labelNames =
    task.labelIds.length > 0
      ? (
          await sql<{ name: string }[]>`
            SELECT name FROM app.task_labels
            WHERE id = ANY(${task.labelIds})
            ORDER BY array_position(${task.labelIds}::text[], id)
          `
        ).map((row) => row.name)
      : [];
  // The agent reads each mention with the CURRENT name of whoever it
  // names: the address is what it acts on, the name what it calls them.
  const names = await currentMentionNames(sql, task.organizationId, [
    task.description ?? '',
    ...discussion.map((entry) => entry.body),
  ]);
  return {
    title: task.title,
    ...(task.description !== null
      ? { description: relabelTaskMentions(task.description, names) }
      : {}),
    ...(labelNames.length > 0 ? { labels: labelNames } : {}),
    ...(identifier !== undefined ? { identifier } : {}),
    ...(project !== undefined ? { projectName: project.name } : {}),
    discussion: discussion.map((entry) => {
      const body = relabelTaskMentions(entry.body, names);
      return {
        author: entry.authorType === 'user' ? 'user' : 'agent',
        // Never cut inside a mention.
        body:
          body.length > BRIEF_COMMENT_MAX_CHARS
            ? `${cutTaskText(body, BRIEF_COMMENT_MAX_CHARS)}\n… (truncated)`
            : body,
        at: entry.createdAt,
      };
    }),
    attachments: fileList(task.attachments),
    outputs: fileList(task.outputs),
  };
}
