/** Real Postgres proof of an automation step's task listing (`task.list`),
 * through the store the native calls (`pgTaskStore`): a run of an
 * automation installed in one project reads that project's tasks newest
 * first — the archived one left out, narrowed to the statuses and the
 * creation moment it names, `hasMore` past its limit, a member assignee
 * named — and a project the automation is not installed in is refused, as
 * a create there is. The lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { appOrigin } from '../../lib/write-origin.ts';
import { deleteAutomationCascade, saveVersion } from '../automations/store.ts';
import { markAutomationWriterInTx } from '../automations/writer-protocol.ts';
import { createProject } from '../projects/service.ts';
import { createTask } from '../tasks/service.ts';
import { pgTaskStore } from './task-store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkTaskListStep(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const automation = `itest-task-list-${suffix}`;
  const newProject = (name: string) =>
    sql.begin((tx) =>
      createProject(tx, auth, { name, deriveKeyOnCollision: true }),
    );
  const home = await newProject(`Task list ${suffix}`);
  const other = await newProject(`Task list elsewhere ${suffix}`);
  const runIds: string[] = [];
  try {
    // The automation exists and is installed in its home project.
    await saveVersion(sql, {
      organizationId: orgId,
      name: automation,
      document: {
        version: 1,
        name: automation,
        nodes: [{ id: 'noop', type: 'transform', code: 'return null;' }],
        output: '{{ nodes.noop.output }}',
      },
      origin: appOrigin(userId),
      projectId: home,
    });
    const make = (
      title: string,
      status: 'todo' | 'done',
      assigned = false,
    ): Promise<string> =>
      transactSerializable(sql, (tx) =>
        createTask(tx, auth, {
          projectId: home,
          title,
          status,
          ...(assigned && { assigneeType: 'user', assigneeId: userId }),
        }),
      );
    const first = await make('First to do', 'todo', true);
    const second = await make('Second to do', 'todo');
    const finished = await make('Finished', 'done');
    const archived = await make('Archived to do', 'todo');
    // Creation moments a second apart, the archived one newest.
    const t0 = Date.now() - 60_000;
    for (const [at, id] of [first, second, finished, archived].entries()) {
      await sql`
        UPDATE app.tasks SET created_at_ms = ${t0 + at * 1000}
        WHERE id = ${id}
      `;
    }
    await sql`
      UPDATE app.tasks SET archived_at_ms = ${Date.now()} WHERE id = ${archived}
    `;

    // A run of the automation in its project, started by the member.
    const [run] = await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      return tx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, status, mode, project_id, started_by,
          started_at_ms
        ) VALUES (
          ${orgId}, ${automation}, 1, 'running', 'live', ${home},
          ${`user:${userId}`}, ${Date.now()}
        )
        RETURNING id
      `;
    });
    if (run === undefined) throw new Error('the run was not written');
    runIds.push(run.id);
    const store = pgTaskStore(sql);
    const caller = {
      kind: 'workflow',
      runId: run.id,
      nodeId: 'tasks',
    } as const;
    const list = (
      args: Partial<Parameters<typeof store.list>[0]> & { projectId: string },
    ) => store.list({ organizationId: orgId, caller, limit: 10, ...args });

    const todo = await list({ projectId: home, statuses: ['todo'] });
    const titles = todo.ok ? todo.tasks.map((task) => task.title) : [];
    const firstRow = todo.ok
      ? todo.tasks.find((task) => task.taskId === first)
      : undefined;
    record(
      'task.list: the project’s To do tasks newest first, the archived one left out, the assignee named [CONN-R27]',
      todo.ok &&
        titles.join('|') === 'Second to do|First to do' &&
        !todo.hasMore &&
        firstRow?.assignee?.type === 'user' &&
        typeof firstRow.assignee.name === 'string' &&
        firstRow.url ===
          `/dashboard/${orgId}/projects/${home}/tasks?task=${first}`,
      JSON.stringify(todo),
    );

    const recent = await list({ projectId: home, createdSince: t0 + 500 });
    record(
      'task.list: only what was created since the moment, in any status',
      recent.ok &&
        recent.tasks.map((task) => task.title).join('|') ===
          'Finished|Second to do',
      JSON.stringify(recent),
    );

    const one = await list({ projectId: home, limit: 1 });
    record(
      'task.list: a limit answers that more match',
      one.ok && one.tasks.length === 1 && one.hasMore,
      JSON.stringify(one),
    );

    const refused = await list({ projectId: other });
    record(
      'task.list: a project the automation is not installed in is refused',
      !refused.ok && refused.refusal.kind === 'project',
      JSON.stringify(refused),
    );
  } finally {
    // The run first: an automation with a live run refuses its delete.
    if (runIds.length > 0) {
      await sql.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`DELETE FROM app.automation_runs WHERE id IN ${tx(runIds)}`;
      });
    }
    await deleteAutomationCascade(sql, {
      organizationId: orgId,
      name: automation,
      origin: appOrigin(userId),
    }).catch((error: unknown) => {
      console.warn(
        '[itest] cleanup of the task.list automation:',
        error instanceof Error ? error.message : error,
      );
    });
    await sql`DELETE FROM app.projects WHERE id IN ${sql([home, other])}`;
  }
}
