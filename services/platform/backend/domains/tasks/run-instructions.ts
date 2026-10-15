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
 *
 * A run on another project's board — its agent's own project's dispatch
 * serves that board (`dispatch-reach.ts`) — is handed both projects'
 * instructions, with which governs what ({@link crossProjectInstructionsBlock}),
 * and records the digest of each.
 */

/** What a run's turn was handed, as SHA-256 hex digests of the exact texts
 * (null where there was none), with the execution that read them. */
export interface RunInstructionsSnapshot {
  /** The task's project's instructions. */
  project: string | null;
  /** The agent's own project's instructions, when the run works another
   * project's board (`dispatch-reach.ts`); absent when it is the same. */
  agentProject?: string | null;
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

/**
 * The instructions block of a run on another project's board: the task's
 * project's instructions and the agent's own project's, with which governs
 * what. The board's own conventions — how its tasks are written, labelled,
 * moved and reported — are the task's project's; how the agent works — the
 * fleet's policy its own project sets — is the agent's project's. Where the
 * two disagree, each wins on its own ground, and the run says so rather than
 * leaving the agent to guess. Null when neither project has instructions.
 */
export function crossProjectInstructionsBlock(args: {
  task: { name: string; key: string | null; instructions: string | null };
  agent: { name: string; key: string | null; instructions: string | null };
}): string | null {
  const board = projectInstructionsBlock(args.task);
  const home = projectInstructionsBlock(args.agent);
  if (board === null && home === null) return null;
  const label = (project: { name: string; key: string | null }) =>
    project.key ? `${project.name} (${project.key})` : project.name;
  return [
    `This task is on the board of project "${label(args.task)}"; you are an agent of project "${label(args.agent)}", whose dispatch serves that board. Follow the board's project for its conventions — how its tasks are written, labelled, moved, reviewed and reported — and your own project for how you work. Where the two disagree, the board's project decides about its board, and your own project decides about your way of working.`,
    ...(board === null ? [] : [board]),
    ...(home === null ? [] : [home]),
  ].join('\n\n');
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
      agentProjectName: string | null;
      agentProjectKey: string | null;
      agentProjectInstructions: string | null;
    }[]
  >`
    SELECT p.name AS "projectName", p.key AS "projectKey",
           p.instructions AS "projectInstructions", t.description,
           ap.name AS "agentProjectName", ap.key AS "agentProjectKey",
           ap.instructions AS "agentProjectInstructions"
    FROM app.tasks t
    JOIN app.projects p ON p.id = t.project_id AND p.org_id = t.org_id
    LEFT JOIN app.project_agent_runs r
      ON r.id = ${args.runId} AND r.org_id = t.org_id
    LEFT JOIN app.project_agents a
      ON a.id = r.agent_id AND a.org_id = r.org_id
    LEFT JOIN app.projects ap
      ON ap.id = coalesce(r.agent_project_id, a.project_id)
     AND ap.org_id = t.org_id AND ap.id <> p.id
    WHERE t.id = ${args.taskId} AND t.org_id = ${args.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) throw new RunInstructionsUnavailableError(args.taskId);
  const agentProjectName =
    typeof row.agentProjectName === 'string' ? row.agentProjectName : null;
  const crossProject = agentProjectName !== null;
  const snapshot: RunInstructionsSnapshot = {
    project: instructionsDigest(row.projectInstructions),
    ...(crossProject
      ? { agentProject: instructionsDigest(row.agentProjectInstructions) }
      : {}),
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
  const board = {
    name: row.projectName,
    key: row.projectKey,
    instructions: row.projectInstructions,
  };
  return {
    projectBlock:
      agentProjectName !== null
        ? crossProjectInstructionsBlock({
            task: board,
            agent: {
              name: agentProjectName,
              key: row.agentProjectKey,
              instructions: row.agentProjectInstructions,
            },
          })
        : projectInstructionsBlock(board),
    snapshot,
  };
}
