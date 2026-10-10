import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { searchTasks } from './service.ts';

export async function checkTaskSearchPriority(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const term = `archivepriority${randomUUID()}`;
  const now = Date.now();
  const auth = {
    organizationId: ctx.orgId,
    userId: ctx.userId,
    role: 'owner',
    teamIds: [],
  };
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${ctx.orgId}, 'Search priority proof', ${ctx.userId}, ${now}, ${now})
  `;
  const addTask = async (
    title: string,
    archived: boolean,
    updatedAt: number,
  ) => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms, archived_at_ms)
      VALUES (${taskId}, ${ctx.orgId}, ${projectId}, ${title}, 'todo', 'a0',
        ${ctx.userId}, 'user', ${now}, ${updatedAt}, ${archived ? now : null})
    `;
    return taskId;
  };
  const comment = async (taskId: string, body: string) => {
    const threadId = randomUUID();
    const messageId = randomUUID();
    await sql`
      INSERT INTO app.threads (id, org_id, kind, created_at_ms, updated_at_ms)
      VALUES (${threadId}, ${ctx.orgId}, 'task_discussion', ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.messages (id, thread_id, org_id, "order", role, text, created_at_ms)
      VALUES (${messageId}, ${threadId}, ${ctx.orgId}, 0, 'user', ${body}, ${now})
    `;
    await sql`
      INSERT INTO app.task_discussion_message_meta
        (message_id, org_id, thread_id, task_id, author_type, author_id, created_at_ms)
      VALUES (${messageId}, ${ctx.orgId}, ${threadId}, ${taskId}, 'user', ${ctx.userId}, ${now})
    `;
  };
  const search = () => searchTasks(sql, auth, { query: term, projectId });
  const activeId = await addTask(
    'Active comment-only match',
    false,
    now - 1000,
  );
  await comment(activeId, `${term} discussion`);
  await comment(activeId, `${term} repeated discussion`);
  const control = await search();
  record(
    'comment-only search control (#3596)',
    control.length === 1 &&
      control[0]?.taskId === activeId &&
      control[0].snippet.includes(term),
    `hits=${control.length}`,
  );

  for (let count = 1; count <= 30; count += 1) {
    await addTask(`${term} archived ${count}`, true, now + count);
    if (count !== 24 && count !== 25 && count !== 30) continue;
    const hits = await search();
    record(
      `active comment survives ${count} archived field hits (#3596)`,
      hits.length === 25 &&
        hits[0]?.taskId === activeId &&
        hits[0].archived === undefined &&
        hits.slice(1).every((hit) => hit.archived === true) &&
        new Set(hits.map((hit) => hit.taskId)).size === hits.length,
      `hits=${hits.length}, activeFirst=${hits[0]?.taskId === activeId}`,
    );
  }

  const dualId = await addTask(`${term} field and comment`, false, now + 200);
  await comment(dualId, `${term} dual discussion`);
  const mixed = await search();
  record(
    'field/comment duplicates are removed before the page limit (#3596)',
    mixed.length === 25 &&
      mixed[0]?.taskId === dualId &&
      mixed[1]?.taskId === activeId &&
      mixed[0].snippet === `${term} field and comment` &&
      new Set(mixed.map((hit) => hit.taskId)).size === 25,
    `hits=${mixed.length}, distinct=${new Set(mixed.map((hit) => hit.taskId)).size}`,
  );

  for (let count = 0; count < 25; count += 1) {
    await addTask(`${term} active field ${count}`, false, now + count);
  }
  await sql`UPDATE app.tasks SET updated_at_ms = ${now + 100} WHERE id = ${activeId}`;
  const fullActivePage = await search();
  record(
    'field/comment recency is ranked together before the limit (#3596)',
    fullActivePage.length === 25 &&
      fullActivePage[0]?.taskId === dualId &&
      fullActivePage[1]?.taskId === activeId &&
      fullActivePage.every((hit) => hit.archived === undefined),
    `hits=${fullActivePage.length}, commentSecond=${fullActivePage[1]?.taskId === activeId}`,
  );
  const ordinaryId = await addTask(`${term} ordinarycontrol`, false, now);
  const ordinary = await searchTasks(sql, auth, {
    projectId,
    query: `${term} ordinarycontrol`,
  });
  const blank = await searchTasks(sql, auth, { projectId, query: '  ' });
  record(
    'ordinary field and blank search controls (#3596)',
    ordinary.length === 1 &&
      ordinary[0]?.taskId === ordinaryId &&
      blank.length === 0,
    `ordinary=${ordinary.length}, blank=${blank.length}`,
  );
}
