import type { Sql, TransactionSql } from 'postgres';

import {
  assertReadable,
  assertWritable,
  listProjects,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';

/**
 * Project visibility for automation runs and bindings. An organization run
 * (no project) is visible to every member; a project run, a binding and a
 * project-scoped listing follow the project's read rule, so a member outside
 * a team-restricted project learns nothing of what ran there. Every door
 * that answers runs — the app routes, the engine/MCP actor and REST — reads
 * the same rule; a hidden project answers exactly like a missing one.
 */

/** The project when the actor may read it; null for a missing or hidden
 * one. Driver failures still throw — an outage is not "not found". */
export async function readableProject(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectRow | null> {
  try {
    const project = await loadProjectOrThrow(sql, projectId);
    assertReadable(project, auth);
    return project;
  } catch (error) {
    if (
      error instanceof ProjectError &&
      (error.code === 'PROJECT_NOT_FOUND' || error.code === 'PROJECT_FORBIDDEN')
    )
      return null;
    throw error;
  }
}

/** Every project the actor may read, archived ones included — the filter
 * run listings and binding lists go through. */
export async function readableProjectIds(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
): Promise<string[]> {
  return (await listProjects(sql, auth, { includeArchived: true })).map(
    (project) => project.id,
  );
}

/**
 * Whether the actor sees an automation installed in `bindings`: one installed
 * nowhere is the organization's and every member's; an installed one is seen
 * by whoever can read one of its projects. One installed only in projects the
 * actor cannot read is left out of every listing and answers "not found" on
 * every read — listed with no installations, it would read as an
 * organization automation, where it cannot run. The rule of the app's
 * listing, the MCP tools and the REST API alike.
 */
export function automationVisible(
  bindings: readonly string[],
  readable: ReadonlySet<string>,
): boolean {
  return bindings.length === 0 || bindings.some((id) => readable.has(id));
}

/** Whether the actor may see a run: an organization run is visible to
 * every member, a project run needs read access to its project. */
export async function canReadRun(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  run: { projectId: string | null },
): Promise<boolean> {
  return (
    run.projectId === null ||
    (await readableProject(sql, auth, run.projectId)) !== null
  );
}

/**
 * Whether the actor may CONTROL a run — cancel it, answer its question, or
 * decide the connector approval it parked on. Reading a run needs project
 * READ access ({@link canReadRun}); acting on it is a WRITE and needs the
 * project's write gate, the same one the REST run door (`loadRestProject`
 * `{write:true}`) and the task workflow door (`assertTaskWritable`) apply —
 * `canReadRun` alone is not authority to mutate. An organization run keeps
 * its member-level control (there is no project write gate to apply); this is
 * the one place org-scoped behaviour is deliberately preserved.
 *
 * - `ok` — an organization run, or a project run the actor may write.
 * - `hidden` — the actor cannot even read the run's project; it answers like a
 *   missing one, so a refused control never confirms the run exists.
 * - `forbidden` — the actor may read the project but not write it (a read-only
 *   member); the control refuses without pretending the run is missing.
 */
export type RunControlAccess = 'ok' | 'hidden' | 'forbidden';

export async function runControlAccess(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  run: { projectId: string | null },
): Promise<RunControlAccess> {
  if (run.projectId === null) return 'ok';
  const project = await readableProject(sql, auth, run.projectId);
  if (project === null) return 'hidden';
  try {
    assertWritable(project, auth);
  } catch (error) {
    if (error instanceof ProjectError) return 'forbidden';
    throw error;
  }
  return 'ok';
}
