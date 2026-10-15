import type { Sql } from 'postgres';

import { getProjectAuthContext } from '../projects/service.ts';
import {
  createProject,
  updateProjectInstructions,
} from '../projects/service.ts';
import { createTask } from '../tasks/service.ts';
import { EXAMPLE_TASKS } from './starter-content.ts';

/**
 * Org provisioning: the starter content of a fresh organization. Runs from
 * the `org.scaffold` job, which the organization's creation queues and
 * `tale migrate` queues again for every organization, so it is IDEMPOTENT: a
 * scaffold retry or a re-run never duplicates anything, and starter content
 * seeds only while the org has no project at all.
 *
 * Provisioning adds no automation and touches none an organization has: the
 * automations that ship with the product are templates a person picks from
 * the template catalog, and one an organization already has keeps its
 * versions, its trigger and its name.
 *
 * The 0.4 default-AGENT provisioner is not ported: it had already been
 * gutted to a logging no-op ("returns with chat v2"), and 0.5 agents are
 * file-backed — the org scaffold seeds the builtin catalog tree.
 */

/**
 * Starter content — a "Getting started" project and a few example tasks
 * (left unassigned so triage can route them). Skips entirely if the org
 * already has any project; best-effort per step, a failure never blocks the
 * org.
 */
export async function seedStarterContent(
  sql: Sql,
  organizationId: string,
): Promise<void> {
  const projects = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.projects
    WHERE org_id = ${organizationId}
  `;
  if (Number(projects[0]?.count ?? '0') > 0) return;

  const auth = await getProjectAuthContext(sql, {
    organizationId,
    userId: 'system',
    role: 'owner',
  });
  let projectId: string;
  try {
    projectId = await sql.begin(async (tx) => {
      const id = await createProject(tx, auth, {
        name: 'Getting started',
        description:
          'A starter project to explore tasks and your agents. Feel free to rename or delete it.',
      });
      await updateProjectInstructions(
        tx,
        auth,
        id,
        'This is an example project. Agents working here should be concise and welcoming, and explain what they did.',
      );
      return id;
    });
  } catch (error) {
    console.error(
      '[seedStarterContent] failed to create starter project',
      error instanceof Error ? error.message : error,
    );
    return;
  }

  for (const task of EXAMPLE_TASKS) {
    try {
      await sql.begin((tx) =>
        createTask(tx, auth, {
          projectId,
          title: task.title,
          description: task.description,
          priority: task.priority,
        }),
      );
    } catch (error) {
      console.warn(
        '[seedStarterContent] failed to create example task',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
