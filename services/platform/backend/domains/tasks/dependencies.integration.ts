import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { listProjectDependencies, TaskError } from './service.ts';

export async function checkTaskDependencyResolution(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const targetId = randomUUID();
  const blockerId = randomUUID();
  const auth = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
    teamIds: [],
  };
  const now = Date.now();
  const projects = [projectId, otherProjectId];
  for (const id of projects) {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${ctx.orgId}, 'Dependency resolution proof', ${ctx.userId}, ${now}, ${now})
    `;
  }
  try {
    for (const [id, title, priority, assignee, reviewer] of [
      [blockerId, 'Live predecessor', 'p3', null, null],
      [targetId, 'Filter blocked target', 'p1', ctx.userId, ctx.userId],
    ]) {
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, priority,
          assignee_type, assignee_id, reviewer_user_id, rank, created_by,
          created_by_type, created_at_ms, updated_at_ms)
        VALUES (${id}, ${ctx.orgId}, ${projectId}, ${title}, ${id === targetId ? 'in_review' : 'todo'}, ${priority},
          ${assignee ? 'user' : null}, ${assignee}, ${reviewer}, 'a0', ${ctx.userId},
          'user', ${now}, ${now})
      `;
    }
    await sql`
      INSERT INTO app.task_dependencies (org_id, project_id, blocker_task_id,
        blocked_task_id, created_by, created_by_type, created_at_ms)
      VALUES (${ctx.orgId}, ${projectId}, ${blockerId}, ${targetId}, ${ctx.userId}, 'user', ${now})
    `;
    const resolved = async () => {
      const edges = await listProjectDependencies(sql, auth, projectId);
      const edge = edges[0];
      if (
        edges.length !== 1 ||
        edge?.blockerTaskId !== blockerId ||
        edge.blockedTaskId !== targetId
      ) {
        throw new Error('Expected the fixture dependency edge');
      }
      return edge.blockerResolved;
    };
    record(
      'a live dependency executes against the task schema',
      !(await resolved()),
      'expected one unresolved edge',
    );

    for (const [filter, predicate] of [
      ['search', sql`title = 'Filter blocked target'`],
      ['assignee', sql`assignee_id = ${ctx.userId}`],
      ['priority', sql`priority = 'p1'`],
      [
        'review',
        sql`status = 'in_review' AND reviewer_user_id = ${ctx.userId}`,
      ],
    ] as const) {
      const visible = await sql<{ id: string }[]>`
        SELECT id FROM app.tasks WHERE project_id = ${projectId} AND ${predicate}
      `;
      record(
        `${filter} filtering hides a live blocker without resolving it`,
        visible.length === 1 &&
          visible[0]?.id === targetId &&
          !(await resolved()),
        'target alone is visible; dependency remains open',
      );
    }

    for (const status of ['done', 'cancelled']) {
      await sql`UPDATE app.tasks SET status = ${status} WHERE id = ${blockerId}`;
      record(
        `a ${status} blocker resolves`,
        await resolved(),
        'expected one resolved edge',
      );
    }
    await sql`UPDATE app.tasks SET status = 'todo', archived_at_ms = ${now} WHERE id = ${blockerId}`;
    record(
      'an archived non-terminal blocker resolves',
      await resolved(),
      'archived todo row still exists',
    );
    await sql`UPDATE app.tasks SET archived_at_ms = NULL WHERE id = ${blockerId}`;
    record(
      'restoring an open blocker reopens the dependency',
      !(await resolved()),
      'restored todo row blocks again',
    );

    await sql`UPDATE app.tasks SET org_id = ${randomUUID()} WHERE id = ${blockerId}`;
    record(
      'another tenant cannot supply blocker state',
      await resolved(),
      'mismatched blocker org is excluded by the join',
    );
    await sql`UPDATE app.tasks SET org_id = ${ctx.orgId}, project_id = ${otherProjectId} WHERE id = ${blockerId}`;
    record(
      'another project cannot supply blocker state',
      await resolved(),
      'mismatched blocker project is excluded by the join',
    );
    await sql`UPDATE app.tasks SET project_id = ${projectId} WHERE id = ${blockerId}`;
    const otherEdges = await listProjectDependencies(sql, auth, otherProjectId);
    record(
      'dependency reads exclude other project edges',
      otherEdges.length === 0,
      'other project has no edges',
    );
    let refused = false;
    try {
      await listProjectDependencies(
        sql,
        { ...auth, organizationId: randomUUID() },
        projectId,
      );
    } catch (error) {
      refused =
        error instanceof TaskError && error.code === 'PROJECT_NOT_FOUND';
    }
    record(
      'another tenant cannot read the project dependency set',
      refused,
      'expected PROJECT_NOT_FOUND',
    );

    await sql`DELETE FROM app.tasks WHERE id = ${blockerId}`;
    const afterDelete = await listProjectDependencies(sql, auth, projectId);
    record(
      'deleting a blocker removes its dependency',
      afterDelete.length === 0,
      'task-schema foreign key cascades the edge',
    );
  } finally {
    await sql`DELETE FROM app.projects WHERE id = ANY(${projects}::text[])`;
  }
}
