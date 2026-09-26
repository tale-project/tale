/** Real Postgres proof of immutable source identity and independent Tale triage. */
import { randomUUID } from 'node:crypto';

import type { TaskExternalIssue } from '@tale/shared/schemas/task-external-issue';
import type { Sql } from 'postgres';

import { pgTaskStore } from '../connectors/task-store.ts';
import { upsertTaskByExternalRef } from './external-ref.ts';
import { loadTaskOrThrow, TaskError } from './service.ts';

export async function checkTaskExternalIssueSync(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const secondProjectId = randomUUID();
  const now = Date.now();
  for (const id of [projectId, secondProjectId]) {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${ctx.orgId}, 'External source proof', ${ctx.userId}, ${now}, ${now})
    `;
  }
  const source: TaskExternalIssue = {
    id: `source-${randomUUID()}`,
    title: 'Upstream issue',
    description: 'Upstream body',
    url: 'https://github.com/example/old-repo/issues/1',
    state: 'open',
    syncedAt: now,
    repositoryId: 42,
    number: 1,
  };
  const sync = (
    snapshot: TaskExternalIssue,
    options: {
      ref?: string;
      organizationId?: string;
      projectId?: string;
    } = {},
  ) =>
    sql.begin((tx) =>
      upsertTaskByExternalRef(tx, {
        organizationId: options.organizationId ?? ctx.orgId,
        projectId: options.projectId ?? projectId,
        actorId: 'workflow',
        externalSystem: 'github',
        externalId: options.ref ?? 'example/old-repo#1',
        title: snapshot.title,
        description: snapshot.description,
        externalUrl: snapshot.url,
        externalIssue: snapshot,
        dedupeScope: 'project',
      }),
    );
  const created = await sync(source);
  if (created.taskId === null)
    throw new Error('source create did not return a task');
  const taskId = created.taskId;
  const initial = await loadTaskOrThrow(sql, taskId, ctx.orgId);
  record(
    'external issue: open source creates one backlog task',
    created.created &&
      initial.status === 'backlog' &&
      initial.externalSourceId === source.id &&
      initial.externalIssue?.state === 'open',
    `task=${taskId}, source=${initial.externalSourceId}, state=${initial.status}`,
  );

  await sql`
    UPDATE app.tasks SET title = 'Human title', description = 'Human description',
      status = 'cancelled', priority = 'p0', assignee_type = 'user', assignee_id = ${ctx.userId}
    WHERE id = ${taskId}
  `;
  const closed: TaskExternalIssue = {
    ...source,
    title: 'Renamed upstream title',
    description: 'Changed upstream body',
    url: 'https://github.com/example/renamed-repo/issues/1',
    state: 'closed',
    syncedAt: now + 1,
  };
  const renamed = await sync(closed, { ref: 'example/renamed-repo#1' });
  const refreshed = await loadTaskOrThrow(sql, taskId, ctx.orgId);
  record(
    'external issue: rename and source closure preserve Tale edits and triage',
    renamed.taskId === taskId &&
      !renamed.created &&
      refreshed.title === 'Human title' &&
      refreshed.description === 'Human description' &&
      refreshed.status === 'cancelled' &&
      refreshed.priority === 'p0' &&
      refreshed.assigneeId === ctx.userId &&
      refreshed.externalId === 'example/renamed-repo#1' &&
      refreshed.externalUrl === closed.url &&
      refreshed.externalIssue?.title === closed.title &&
      refreshed.externalIssue.state === 'closed',
    `same=${renamed.taskId === taskId}, Tale=${refreshed.status}, source=${refreshed.externalIssue?.state}`,
  );

  await sync({ ...source, syncedAt: now - 1 });
  const stale = await loadTaskOrThrow(sql, taskId, ctx.orgId);
  record(
    'external issue: an older overlapping read cannot replace newer source state',
    stale.externalIssue?.state === 'closed' &&
      stale.externalId === 'example/renamed-repo#1',
    `source=${stale.externalIssue?.state}, locator=${stale.externalId}`,
  );
  await sync({ ...source, syncedAt: now + 2 });
  record(
    'external issue: upstream reopen never reopens a cancelled Tale task',
    (await loadTaskOrThrow(sql, taskId, ctx.orgId)).status === 'cancelled',
    'local rejection remains authoritative',
  );

  await sql`UPDATE app.tasks SET archived_at_ms = ${now} WHERE id = ${taskId}`;
  await sync({ ...closed, unavailable: true, syncedAt: now + 3 });
  const archived = await loadTaskOrThrow(sql, taskId, ctx.orgId);
  record(
    'external issue: archived and unavailable source refresh retains local archival',
    archived.archivedAt === now &&
      archived.externalIssue?.unavailable === true &&
      archived.title === 'Human title',
    `archived=${archived.archivedAt}, unavailable=${archived.externalIssue?.unavailable}`,
  );

  const skipped = await Promise.all(
    (['closed', 'resolved', 'ignored'] as const).map((state) =>
      sync({ ...source, id: randomUUID(), state }, { ref: randomUUID() }),
    ),
  );
  skipped.push(
    await sync(
      { ...source, id: randomUUID(), unavailable: true },
      { ref: randomUUID() },
    ),
  );
  record(
    'external issue: inactive and unavailable sources never create new tasks',
    skipped.every((result) => result.taskId === null && !result.created),
    `${skipped.length} source states skipped`,
  );

  const legacyRef = `legacy-${randomUUID()}`;
  const legacy = await sql.begin((tx) =>
    upsertTaskByExternalRef(tx, {
      organizationId: ctx.orgId,
      projectId,
      actorId: 'workflow',
      externalSystem: 'github',
      externalId: legacyRef,
      title: 'Legacy human title',
      description: 'Legacy description',
      dedupeScope: 'project',
    }),
  );
  const adopted = await sync(
    { ...source, id: randomUUID() },
    { ref: legacyRef },
  );
  record(
    'external issue: legacy locator adopts a stable identity without replacing its task',
    legacy.taskId === adopted.taskId &&
      !adopted.created &&
      (await loadTaskOrThrow(sql, adopted.taskId ?? '', ctx.orgId)).title ===
        'Legacy human title',
    `same=${legacy.taskId === adopted.taskId}`,
  );

  const raceSource = { ...source, id: randomUUID() };
  const racing = await Promise.all([
    sync(raceSource, { ref: `before-${randomUUID()}` }),
    sync(raceSource, { ref: `after-${randomUUID()}` }),
  ]);
  record(
    'external issue: concurrent aliases for one vendor id create one task',
    racing[0]?.taskId === racing[1]?.taskId &&
      racing.filter((result) => result.created).length === 1,
    `tasks=${racing.map((result) => result.taskId).join(',')}`,
  );
  const otherProject = await sync(source, { projectId: secondProjectId });
  record(
    'external issue: separate projects may import the same vendor issue',
    otherProject.created && otherProject.taskId !== taskId,
    `task=${otherProject.taskId}`,
  );

  let rejected = false;
  try {
    await sync(source, { organizationId: `foreign-${randomUUID()}` });
  } catch (error) {
    rejected = error instanceof TaskError && error.code === 'PROJECT_NOT_FOUND';
  }
  record(
    'external issue: a foreign organization cannot resolve or mutate the source task',
    rejected,
    `rejected=${rejected}`,
  );

  let collision = false;
  try {
    await sync({ ...source, id: randomUUID() });
  } catch (error) {
    collision =
      error instanceof TaskError && error.code === 'TASK_EXTERNAL_REF_INVALID';
  }
  record(
    'external issue: a reused locator never aliases a different immutable vendor id',
    collision,
    `rejected=${collision}`,
  );

  const occupiedRef = `occupied-${randomUUID()}`;
  await sync({ ...source, id: randomUUID() }, { ref: occupiedRef });
  let renameCollision = false;
  try {
    await sync({ ...source, syncedAt: now + 4 }, { ref: occupiedRef });
  } catch (error) {
    renameCollision =
      error instanceof TaskError && error.code === 'TASK_EXTERNAL_REF_INVALID';
  }
  const afterCollision = await loadTaskOrThrow(sql, taskId, ctx.orgId);
  record(
    'external issue: a conflicting source rename fails clearly without partial updates',
    renameCollision &&
      afterCollision.externalId === 'example/old-repo#1' &&
      afterCollision.externalIssue?.syncedAt === now + 3,
    `rejected=${renameCollision}, source unchanged=${afterCollision.externalIssue?.syncedAt === now + 3}`,
  );

  for (const externalSystem of ['github', 'glitchtip']) {
    const legacyInput = {
      organizationId: ctx.orgId,
      projectId,
      actorId: 'workflow',
      externalSystem,
      externalId: `historical-${randomUUID()}`,
      title: 'Legacy issue',
      dedupeScope: 'project' as const,
    };
    const legacyCreated = await sql.begin((tx) =>
      upsertTaskByExternalRef(tx, { ...legacyInput, externalState: 'closed' }),
    );
    const createdRow = await loadTaskOrThrow(
      sql,
      legacyCreated.taskId ?? '',
      ctx.orgId,
    );
    await sql`UPDATE app.tasks SET status = 'done', completed_at_ms = ${now}, status_changed_at_ms = ${now} WHERE id = ${createdRow.id}`;
    await sql.begin((tx) =>
      upsertTaskByExternalRef(tx, { ...legacyInput, externalState: 'open' }),
    );
    const historicalRow = await loadTaskOrThrow(sql, createdRow.id, ctx.orgId);
    record(
      `external issue: historical ${externalSystem} flags cannot complete or reopen Tale work`,
      createdRow.status === 'backlog' &&
        historicalRow.status === 'done' &&
        historicalRow.completedAt === now &&
        historicalRow.statusChangedAt === now,
      `created=${createdRow.status}, repeated=${historicalRow.status}`,
    );
  }

  await checkLegacySourceDiscovery(sql, ctx, record);
}

async function checkLegacySourceDiscovery(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const now = Date.now();
  for (const id of [projectId, otherProjectId]) {
    await sql`INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${ctx.orgId}, 'Legacy source discovery', ${ctx.userId}, ${now}, ${now})`;
  }
  const create = async (
    externalSystem: string,
    externalId: string,
    destination = projectId,
    externalIssue?: TaskExternalIssue,
  ) => {
    const result = await sql.begin((tx) =>
      upsertTaskByExternalRef(tx, {
        organizationId: ctx.orgId,
        projectId: destination,
        actorId: 'workflow',
        externalSystem,
        externalId,
        title: 'Source discovery',
        externalIssue,
        dedupeScope: 'project',
      }),
    );
    if (!result.taskId) throw new Error('Expected a discovery fixture task');
    return result.taskId;
  };
  const legacyId = await create('github', 'example/old-repo#7');
  const ignoredIds = [
    await create('github', 'example/other#7'),
    await create('github', 'example/old-repo-extra#7'),
    await create('glitchtip', 'example/old-repo#7'),
    await create('github', 'example/old-repo#7', otherProjectId),
  ];
  const snapshot: TaskExternalIssue = {
    id: randomUUID(),
    title: 'Upstream',
    description: '',
    state: 'open',
    url: 'https://github.com/example/new-repo/issues/8',
    repositoryId: 73,
    number: 8,
    syncedAt: now,
  };
  const trackedId = await create(
    'github',
    'example/new-repo#8',
    projectId,
    snapshot,
  );
  ignoredIds.push(
    await create('github', 'example/unrelated#9', projectId, {
      ...snapshot,
      id: randomUUID(),
      repositoryId: 74,
    }),
  );
  const store = pgTaskStore(sql);
  const query = {
    organizationId: ctx.orgId,
    projectId,
    caller: {
      kind: 'system' as const,
      reason: 'isolated source integration proof',
    },
    externalSystem: 'github' as const,
    repositoryId: 73,
    legacyPrefixes: ['example/old-repo#'],
    limit: 1,
  };
  const first = await store.listExternalIssues(query);
  const all = await store.listExternalIssues({ ...query, limit: 500 });
  record(
    'external issue: discovery includes bounded legacy and stable source matches only',
    first.hasMore &&
      first.issues[0]?.taskId === legacyId &&
      first.issues[0]?.externalIssue === null &&
      all.issues.length === 2 &&
      all.issues.some((issue) => issue.taskId === trackedId) &&
      all.issues.every((issue) => !ignoredIds.includes(issue.taskId)),
    `oldest=${first.issues[0]?.taskId === legacyId}, matched=${all.issues.length}, hasMore=${first.hasMore}`,
  );

  await sql`UPDATE app.tasks SET title='Legacy human edit', status='in_progress' WHERE id=${legacyId}`;
  const closed = {
    ...snapshot,
    id: randomUUID(),
    number: 7,
    state: 'closed' as const,
    url: 'https://github.com/example/new-repo/issues/7',
    syncedAt: now + 1,
  };
  const hydratedId = await create(
    'github',
    'example/old-repo#7',
    projectId,
    closed,
  );
  const renamedId = await create('github', 'example/new-repo#7', projectId, {
    ...closed,
    syncedAt: now + 2,
  });
  const hydrated = await loadTaskOrThrow(sql, legacyId, ctx.orgId);
  record(
    'external issue: a renamed closed legacy issue hydrates without duplicate or local edits',
    hydratedId === legacyId &&
      renamedId === legacyId &&
      hydrated.title === 'Legacy human edit' &&
      hydrated.status === 'in_progress' &&
      hydrated.externalIssue?.state === 'closed' &&
      hydrated.externalId === 'example/new-repo#7' &&
      hydrated.externalUrl === closed.url,
    `same=${hydratedId === legacyId && renamedId === legacyId}, local=${hydrated.status}, source=${hydrated.externalIssue?.state}`,
  );

  const next = await store.listExternalIssues(query);
  record(
    'external issue: subsequent refresh selects the oldest remaining snapshot',
    next.issues[0]?.taskId === trackedId && next.hasMore,
    `next=${next.issues[0]?.taskId}, expected=${trackedId}`,
  );

  const origin = 'https://errors.example.test';
  const glitchLegacyId = await create(
    'glitchtip',
    `${origin}/sample/old-project#12`,
  );
  const glitchSnapshot: TaskExternalIssue = {
    id: `${origin}#13`,
    title: 'Error',
    description: '',
    state: 'open',
    url: `${origin}/sample/issues/13`,
    sourceProjectId: '91',
    syncedAt: now,
  };
  const glitchTrackedId = await create(
    'glitchtip',
    `${origin}/sample/new-project#13`,
    projectId,
    glitchSnapshot,
  );
  const foreignInstanceId = await create(
    'glitchtip',
    'https://foreign.example.test/sample/new-project#14',
    projectId,
    { ...glitchSnapshot, id: 'https://foreign.example.test#14' },
  );
  const otherSourceProjectId = await create(
    'glitchtip',
    `${origin}/sample/other-project#15`,
    projectId,
    { ...glitchSnapshot, id: `${origin}#15`, sourceProjectId: '92' },
  );
  const glitchList = await store.listExternalIssues({
    ...query,
    externalSystem: 'glitchtip',
    repositoryId: undefined,
    sourceOrigin: origin,
    sourceProjectId: '91',
    legacyPrefixes: [`${origin}/sample/old-project#`],
    limit: 500,
  });
  record(
    'external issue: GlitchTip discovery isolates instance, project and legacy prefix',
    glitchList.issues.length === 2 &&
      glitchList.issues.some((issue) => issue.taskId === glitchLegacyId) &&
      glitchList.issues.some((issue) => issue.taskId === glitchTrackedId) &&
      glitchList.issues.every(
        (issue) =>
          issue.taskId !== foreignInstanceId &&
          issue.taskId !== otherSourceProjectId,
      ),
    `matched=${glitchList.issues.length}`,
  );
}
