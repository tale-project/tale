import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import { toJson } from '../../db/sql.ts';

/**
 * The project's instructions a task agent's turn opens with, and the record
 * of what the turn was handed (migration 0209).
 *
 * A chat in a project starts with the project's instructions; a task run did
 * not, so a project that ran a fleet of agents told every agent, in every
 * brief, to read them back before deciding anything — and an agent that
 * resumed a conversation kept working from the copy it remembered. Every turn
 * now reads them when it starts, beside the agent's own instructions and the
 * task's description, and the run records the SHA-256 of each: which version
 * a run worked from is a fact on the run, not a receipt an agent writes.
 *
 * A turn whose project or task cannot be read does not start: it would work
 * without the instructions it is meant to follow.
 */

/** What a run's turn was handed, as SHA-256 hex digests of the exact texts
 * (null where there was none), with the execution that read them. */
export interface RunInstructionsSnapshot {
  project: string | null;
  agent: string | null;
  task: string | null;
  execId: string;
  takenAt: number;
}

/** SHA-256 hex of the exact text a turn is handed; null for none. */
export function instructionsDigest(
  text: string | null | undefined,
): string | null {
  if (text === null || text === undefined || text.trim() === '') return null;
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The block a turn's instructions carry for its project, or null when the
 * project has no instructions. */
export function projectInstructionsBlock(project: {
  name: string;
  key: string | null;
  instructions: string | null;
}): string | null {
  if (project.instructions === null || project.instructions.trim() === '') {
    return null;
  }
  const label = project.key ? `${project.name} (${project.key})` : project.name;
  return [
    `Instructions for project "${label}", as they read when this turn started. They apply to every task in the project and replace any earlier copy of them in this conversation:`,
    project.instructions,
  ].join('\n');
}

export class RunInstructionsUnavailableError extends Error {
  constructor(taskId: string) {
    super(
      `The project and task of task ${taskId} could not be read, so the turn cannot be handed its instructions`,
    );
    this.name = 'RunInstructionsUnavailableError';
  }
}

/**
 * Read the project's instructions and the task's description for a turn
 * that is starting, record on the run what the turn is handed, and answer
 * the project block for its instructions. The record is fenced on the
 * execution: a start whose execution was rotated away records nothing (the
 * start stands down at its launch).
 */
export async function snapshotRunInstructions(
  sql: Sql,
  args: {
    organizationId: string;
    runId: string;
    taskId: string;
    execId: string;
    agentInstructions: string | null;
    now?: number;
  },
): Promise<{
  projectBlock: string | null;
  snapshot: RunInstructionsSnapshot;
}> {
  const rows = await sql<
    {
      projectName: string;
      projectKey: string | null;
      projectInstructions: string | null;
      description: string | null;
    }[]
  >`
    SELECT p.name AS "projectName", p.key AS "projectKey",
           p.instructions AS "projectInstructions", t.description
    FROM app.tasks t
    JOIN app.projects p ON p.id = t.project_id AND p.org_id = t.org_id
    WHERE t.id = ${args.taskId} AND t.org_id = ${args.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) throw new RunInstructionsUnavailableError(args.taskId);
  const snapshot: RunInstructionsSnapshot = {
    project: instructionsDigest(row.projectInstructions),
    agent: instructionsDigest(args.agentInstructions),
    task: instructionsDigest(row.description),
    execId: args.execId,
    takenAt: args.now ?? Date.now(),
  };
  await sql`
    UPDATE app.project_agent_runs
    SET instructions_snapshot = ${sql.json(toJson(snapshot))}
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND exec_id = ${args.execId}
  `;
  return {
    projectBlock: projectInstructionsBlock({
      name: row.projectName,
      key: row.projectKey,
      instructions: row.projectInstructions,
    }),
    snapshot,
  };
}
