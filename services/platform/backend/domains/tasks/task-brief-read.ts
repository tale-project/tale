import type { Sql } from 'postgres';

import type { TaskBriefFacts } from '../../../lib/agent/task-brief.ts';
import { cutTaskText, relabelTaskMentions } from '../../core/tasks/mentions.ts';
import { withheldFile, type WithheldFile } from '../agent_tools/artifacts.ts';
import { currentMentionNames } from '../collab/mention-directory.ts';
import { readAgentTaskLabels } from './agent-labels.ts';

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
  /** Why no tool may take an attachment the task's people added: the
   * organization's secret scan or PII policy refused it, or is still
   * checking it ({@link withheldFile}). A harness run stages it nowhere. */
  withheld?: WithheldFile;
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

/** The attachments of a task, each with why no tool may take it, if a
 * check withholds it — read from the file's row as every tool that takes
 * files reads it, the earliest row of a ref first. */
async function attachmentsWithChecks(
  sql: Sql,
  organizationId: string,
  attachments: TaskBriefFile[],
): Promise<TaskBriefFile[]> {
  if (attachments.length === 0) return attachments;
  const rows = await sql<
    ({ ref: string } & Parameters<typeof withheldFile>[0])[]
  >`
    SELECT storage_ref AS ref,
           text_status AS "textStatus", text_error_code AS "textErrorCode",
           rag_status AS "ragStatus", rag_error_code AS "ragErrorCode"
    FROM app.file_metadata
    WHERE org_id = ${organizationId}
      AND storage_ref = ANY(${attachments.map((file) => file.fileId)})
    ORDER BY created_at_ms ASC
  `;
  const withheld = new Map<string, WithheldFile | undefined>();
  for (const row of rows) {
    if (!withheld.has(row.ref)) withheld.set(row.ref, withheldFile(row));
  }
  return attachments.map((file) => {
    const why = withheld.get(file.fileId);
    return why === undefined ? file : { ...file, withheld: why };
  });
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
  // The labels as every agent-facing read names them — the task's
  // `task_find` row and its `task_get` read alike [TASK-R83].
  const labelNames =
    (
      await readAgentTaskLabels(sql, task.organizationId, [
        { id: taskId, projectId: task.projectId, labelIds: task.labelIds },
      ])
    ).get(taskId) ?? [];
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
    attachments: await attachmentsWithChecks(
      sql,
      task.organizationId,
      fileList(task.attachments),
    ),
    outputs: fileList(task.outputs),
  };
}
