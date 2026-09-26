/** Real Postgres proof of immutable source identity and independent Tale triage. */
import { randomUUID } from 'node:crypto';

import type { TaskExternalIssue } from '@tale/shared/schemas/task-external-issue';
import type { Sql } from 'postgres';

import type { WorkflowIssueInput } from '../../../lib/connectors/natives/platform-tasks.ts';
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
  await checkIssueBatchTransactions(sql, ctx, record);
  await checkIssueRefreshFairness(sql, ctx, record);
  await checkTransferredIssueTracking(sql, ctx, record);
}

async function checkTransferredIssueTracking(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const store = pgTaskStore(sql);
  const origin = 'https://transfers.example.test';
  for (const provider of ['github', 'glitchtip'] as const) {
    for (const legacy of [false, true]) {
      const projectId = randomUUID();
      const now = Date.now();
      await sql`INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
        VALUES (${projectId}, ${ctx.orgId}, 'Transferred source proof', ${ctx.userId}, ${now}, ${now})`;
      const prefix = (scope: number, instance = origin) =>
        provider === 'github'
          ? `example/repo-${scope}#`
          : `${instance}/example/project-${scope}#`;
      const snapshot = (
        scope: number,
        instance = origin,
      ): TaskExternalIssue => ({
        id: provider === 'github' ? `transfer-${projectId}` : `${instance}#1`,
        title: 'Upstream transfer',
        description: 'Source details',
        state: 'open',
        syncedAt: now + scope,
        url:
          provider === 'github'
            ? `https://github.com/example/repo-${scope}/issues/1`
            : `${instance}/example/issues/1`,
        ...(provider === 'github'
          ? { repositoryId: scope, number: 1 }
          : { sourceProjectId: String(scope) }),
      });
      const write = (
        scope: number,
        issue?: TaskExternalIssue,
        instance = origin,
      ) =>
        store.upsertIssues({
          organizationId: ctx.orgId,
          projectId,
          caller: { kind: 'system', reason: 'isolated transfer proof' },
          issues: [
            {
              externalSystem: provider,
              externalId: `${prefix(scope, instance)}1`,
              title: 'Imported title',
              ...(issue ? { externalIssue: issue } : {}),
            },
          ],
        });
      const query = (scope: number) =>
        store.listExternalIssues({
          organizationId: ctx.orgId,
          projectId,
          caller: { kind: 'system', reason: 'isolated transfer proof' },
          externalSystem: provider,
          ...(provider === 'github'
            ? { repositoryId: scope }
            : { sourceOrigin: origin, sourceProjectId: String(scope) }),
          legacyPrefixes: [prefix(scope)],
          limit: 500,
        });
      const initial = await write(41, legacy ? undefined : snapshot(41));
      const taskId = initial[0]?.taskId;
      if (!taskId) throw new Error('Expected a transferred issue task');
      await sql`UPDATE app.tasks SET title='Human transfer title', status='in_progress' WHERE id=${taskId}`;
      if (legacy) {
        // Remember an authorized legacy scope before the first remote read
        // reveals that the issue already moved to another source project.
        await query(41);
      } else {
        // Previous images have snapshots but no scope bookkeeping. Their
        // first update must retain the old scope without relying on a list.
        await sql`UPDATE app.tasks SET external_issue_source_scopes=NULL WHERE id=${taskId}`;
      }
      await write(legacy ? 41 : 42, snapshot(42));
      const afterFirstMove = await query(41);
      record(
        `external issue: ${provider} ${legacy ? 'legacy' : 'tracked'} transfer remains in its original refresh scope`,
        afterFirstMove.issues.some((issue) => issue.taskId === taskId),
        `original scope matched=${afterFirstMove.issues.length}`,
      );
      await query(42);
      await write(43, snapshot(43));
      const scopeLists = await Promise.all([query(41), query(42), query(43)]);
      record(
        `external issue: ${provider} ${legacy ? 'legacy' : 'tracked'} repeated transfer retains original and intermediate scopes`,
        scopeLists.every((list) =>
          list.issues.some((issue) => issue.taskId === taskId),
        ),
        `scope matches=${scopeLists.map((list) => list.issues.length).join(',')}`,
      );
      const resolved = {
        ...snapshot(43),
        state:
          provider === 'github' ? ('closed' as const) : ('resolved' as const),
        syncedAt: now + 44,
      };
      await write(43, resolved);
      const refreshed = await loadTaskOrThrow(sql, taskId, ctx.orgId);
      const retained = await sql<{ scopes: string[] }[]>`
        SELECT external_issue_source_scopes AS scopes FROM app.tasks WHERE id=${taskId}
      `;
      record(
        `external issue: ${provider} ${legacy ? 'legacy' : 'tracked'} transferred resolution preserves local triage`,
        refreshed.title === 'Human transfer title' &&
          refreshed.status === 'in_progress' &&
          refreshed.externalIssue?.state === resolved.state &&
          refreshed.externalUrl === resolved.url &&
          retained[0]?.scopes.length === 3 &&
          ['41', '42', '43'].every((scope) =>
            retained[0]?.scopes.includes(scope),
          ),
        `local=${refreshed.status}, source=${refreshed.externalIssue?.state}`,
      );
      if (provider === 'glitchtip') {
        const foreign = 'https://foreign-transfers.example.test';
        const foreignCreated = await write(41, snapshot(41, foreign), foreign);
        await write(43, snapshot(43, foreign), foreign);
        const sameScope = await query(41);
        record(
          `external issue: GlitchTip ${legacy ? 'legacy' : 'tracked'} retained scope cannot cross instances`,
          sameScope.issues.length === 1 &&
            sameScope.issues[0]?.taskId === taskId &&
            sameScope.issues.every(
              (issue) => issue.taskId !== foreignCreated[0]?.taskId,
            ),
          `matching tasks=${sameScope.issues.length}`,
        );
      }
    }
  }
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
  const legacyId = await create('github', 'Example/Old-Repo#7');
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
  const caseFoldedRows = await sql<{ id: string }[]>`
    SELECT id FROM app.tasks WHERE org_id=${ctx.orgId} AND project_id=${projectId}
      AND external_system='github'
      AND (lower(external_id)='example/old-repo#7' OR external_source_id=${closed.id})
  `;
  record(
    'external issue: uppercase GitHub legacy locator adopts canonical source without duplicating the task',
    hydratedId === legacyId &&
      caseFoldedRows.length === 1 &&
      hydrated.status === 'in_progress' &&
      hydrated.title === 'Legacy human edit',
    `same=${hydratedId === legacyId}, tasks=${caseFoldedRows.length}, local=${hydrated.status}`,
  );
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

  const uppercaseTwinId = await create('github', 'Example/Case-Twins#17');
  const exactTwinId = await create('github', 'example/case-twins#17');
  await sql`UPDATE app.tasks SET title='Uppercase human task', status='in_progress' WHERE id=${uppercaseTwinId}`;
  await sql`UPDATE app.tasks SET title='Exact human task', status='cancelled' WHERE id=${exactTwinId}`;
  const twinSnapshot: TaskExternalIssue = {
    ...snapshot,
    id: randomUUID(),
    number: 17,
    state: 'closed',
    url: 'https://github.com/example/case-twins/issues/17',
    syncedAt: now + 3,
  };
  const chosenTwinId = await create(
    'github',
    'example/case-twins#17',
    projectId,
    twinSnapshot,
  );
  const chosenTwin = await loadTaskOrThrow(sql, exactTwinId, ctx.orgId);
  const untouchedTwin = await loadTaskOrThrow(sql, uppercaseTwinId, ctx.orgId);
  record(
    'external issue: exact GitHub legacy locator wins over a case twin without merging tasks',
    chosenTwinId === exactTwinId &&
      chosenTwin.externalSourceId === twinSnapshot.id &&
      chosenTwin.externalIssue?.syncedAt === twinSnapshot.syncedAt &&
      chosenTwin.title === 'Exact human task' &&
      chosenTwin.status === 'cancelled' &&
      untouchedTwin.externalSourceId === null &&
      untouchedTwin.externalIssue === null &&
      untouchedTwin.externalId === 'Example/Case-Twins#17' &&
      untouchedTwin.title === 'Uppercase human task' &&
      untouchedTwin.status === 'in_progress',
    `exact=${chosenTwinId === exactTwinId}, other source=${untouchedTwin.externalSourceId}`,
  );

  let twinCollision = false;
  try {
    await create('github', 'Example/Case-Twins#17', projectId, {
      ...twinSnapshot,
      title: 'Conflicting observation',
      syncedAt: now + 4,
    });
  } catch (error) {
    twinCollision =
      error instanceof TaskError &&
      error.code === 'TASK_EXTERNAL_REF_INVALID' &&
      error.status === 409;
  }
  const afterTwinCollision = await loadTaskOrThrow(sql, exactTwinId, ctx.orgId);
  const afterOtherTwinCollision = await loadTaskOrThrow(
    sql,
    uppercaseTwinId,
    ctx.orgId,
  );
  record(
    'external issue: stable identity outranks a legacy case twin and collision leaves both tasks unchanged',
    twinCollision &&
      JSON.stringify(afterTwinCollision) === JSON.stringify(chosenTwin) &&
      JSON.stringify(afterOtherTwinCollision) === JSON.stringify(untouchedTwin),
    `rejected=${twinCollision}, source unchanged=${afterTwinCollision.externalIssue?.syncedAt === twinSnapshot.syncedAt}`,
  );
}

async function checkIssueBatchTransactions(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const now = Date.now();
  await sql`INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${ctx.orgId}, 'Concurrent issue batch proof', ${ctx.userId}, ${now}, ${now})`;
  const store = pgTaskStore(sql);
  const scope = {
    organizationId: ctx.orgId,
    projectId,
    caller: { kind: 'system' as const, reason: 'isolated issue batch proof' },
  };
  const issues: WorkflowIssueInput[] = Array.from({ length: 40 }, (_, at) => ({
    externalSystem: 'github',
    externalId: `example/concurrent#${at + 1}`,
    title: `Source ${at + 1}`,
    externalIssue: {
      id: `batch-${String(at + 1).padStart(3, '0')}`,
      title: `Source ${at + 1}`,
      description: 'Source body',
      url: `https://github.com/example/concurrent/issues/${at + 1}`,
      state: 'open',
      syncedAt: now,
      repositoryId: 991,
      number: at + 1,
    },
  }));
  const bursts = await Promise.allSettled(
    Array.from({ length: 8 }, (_, at) =>
      store.upsertIssues({
        ...scope,
        issues: at % 2 === 0 ? issues : issues.toReversed(),
      }),
    ),
  );
  const completed = bursts.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const rows = await sql<{ id: string; external_source_id: string }[]>`
    SELECT id, external_source_id FROM app.tasks WHERE project_id = ${projectId}
  `;
  const bySource = new Map(rows.map((row) => [row.external_source_id, row.id]));
  record(
    'external issue: eight overlapping reversed batches complete with one task per source',
    completed.length === 8 &&
      completed.flat().filter((result) => result.created).length === 40 &&
      rows.length === 40 &&
      bySource.size === 40 &&
      completed.every((batch, at) => {
        const expected = at % 2 === 0 ? issues : issues.toReversed();
        return batch.every(
          (result, index) =>
            result.taskId ===
            bySource.get(expected[index]?.externalIssue?.id ?? ''),
        );
      }),
    `completed=${completed.length}/8, tasks=${rows.length}, unique=${bySource.size}`,
  );

  const first = issues[0];
  const second = issues[1];
  const third = issues[2];
  if (!first?.externalIssue || !second?.externalIssue || !third?.externalIssue)
    throw new Error('Missing source fixtures');
  const before = await sql`
    SELECT * FROM app.tasks WHERE project_id = ${projectId} ORDER BY id
  `;
  const projectBefore =
    await sql`SELECT * FROM app.projects WHERE id = ${projectId}`;
  let rejected = false;
  try {
    await store.upsertIssues({
      ...scope,
      issues: [
        {
          ...first,
          externalIssue: {
            ...first.externalIssue,
            title: 'Must roll back',
            syncedAt: now + 1,
          },
        },
        {
          ...second,
          externalId: 'example/concurrent#41',
          externalIssue: {
            ...second.externalIssue,
            id: 'batch-041',
            number: 41,
          },
        },
        {
          ...third,
          externalIssue: {
            ...third.externalIssue,
            id: 'zzz-conflicting-source',
          },
        },
      ],
    });
  } catch (error) {
    rejected =
      error instanceof TaskError &&
      error.code === 'TASK_EXTERNAL_REF_INVALID' &&
      error.status === 409;
  }
  const after = await sql`
    SELECT * FROM app.tasks WHERE project_id = ${projectId} ORDER BY id
  `;
  const projectAfter =
    await sql`SELECT * FROM app.projects WHERE id = ${projectId}`;
  record(
    'external issue: a late batch conflict rolls back earlier inserts, updates and project counters',
    rejected &&
      JSON.stringify(before) === JSON.stringify(after) &&
      JSON.stringify(projectBefore) === JSON.stringify(projectAfter),
    `rejected=${rejected}, unchanged tasks=${JSON.stringify(before) === JSON.stringify(after)}, unchanged project=${JSON.stringify(projectBefore) === JSON.stringify(projectAfter)}`,
  );
}

async function checkIssueRefreshFairness(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const projectId = randomUUID();
  const now = Date.now();
  await sql`INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${projectId}, ${ctx.orgId}, 'Source refresh fairness', ${ctx.userId}, ${now}, ${now})`;
  const store = pgTaskStore(sql);
  const scope = {
    organizationId: ctx.orgId,
    projectId,
    caller: {
      kind: 'system' as const,
      reason: 'isolated refresh fairness proof',
    },
  };
  const queries: Parameters<typeof store.listExternalIssues>[0][] = [];
  for (const provider of ['github', 'glitchtip'] as const) {
    const origin = 'https://errors.example.test';
    const prefix =
      provider === 'github' ? 'example/fair#' : `${origin}/example/fair#`;
    const legacy = await store.upsert({
      ...scope,
      externalSystem: provider,
      externalId: `${prefix}1`,
      title: 'Legacy issue',
    });
    const snapshot: TaskExternalIssue = {
      id: provider === 'github' ? 'fair-2' : `${origin}#2`,
      title: 'Last known issue',
      description: 'Last known body',
      url:
        provider === 'github'
          ? 'https://github.com/example/fair/issues/2'
          : `${origin}/example/issues/2`,
      state: 'open',
      syncedAt: now - 10_000,
      ...(provider === 'github'
        ? { repositoryId: 1991, number: 2 }
        : { sourceProjectId: '1991' }),
    };
    const tracked = await store.upsert({
      ...scope,
      externalSystem: provider,
      externalId: `${prefix}2`,
      title: 'Human task',
      externalIssue: snapshot,
    });
    if (!legacy.taskId || !tracked.taskId)
      throw new Error('Missing fairness tasks');
    const localBefore = await Promise.all(
      [legacy.taskId, tracked.taskId].map((id) =>
        loadTaskOrThrow(sql, id, ctx.orgId),
      ),
    );
    const query = {
      ...scope,
      externalSystem: provider,
      legacyPrefixes: [prefix],
      limit: 1,
      ...(provider === 'github'
        ? { repositoryId: 1991 }
        : { sourceOrigin: origin, sourceProjectId: '1991' }),
    };
    queries.push(query);
    const first = await store.listExternalIssues(query);
    // A legacy issue returning HTTP404 has no snapshot to write; a failed
    // upstream read likewise commits no source update. Both must rotate.
    const second = await store.listExternalIssues(query);
    const localAfter = await Promise.all(
      [legacy.taskId, tracked.taskId].map((id) =>
        loadTaskOrThrow(sql, id, ctx.orgId),
      ),
    );
    const all = await store.listExternalIssues({ ...query, limit: 500 });
    record(
      `external issue: ${provider} missing or failed attempts rotate without altering Tale or source observations`,
      first.issues[0]?.taskId === legacy.taskId &&
        first.hasMore &&
        second.issues[0]?.taskId === tracked.taskId &&
        second.hasMore &&
        JSON.stringify(localBefore) === JSON.stringify(localAfter) &&
        all.issues.length === 2 &&
        !all.hasMore &&
        all.issues.some(
          (issue) =>
            issue.taskId === legacy.taskId && issue.externalIssue === null,
        ) &&
        all.issues.some(
          (issue) =>
            issue.taskId === tracked.taskId &&
            issue.externalIssue?.syncedAt === snapshot.syncedAt,
        ),
      `first legacy=${first.issues[0]?.taskId === legacy.taskId}, next tracked=${second.issues[0]?.taskId === tracked.taskId}, local unchanged=${JSON.stringify(localBefore) === JSON.stringify(localAfter)}`,
    );
    for (const futureClock of ['snapshot', 'attempt'] as const) {
      const future = Date.now() + 60_000;
      await sql`
        UPDATE app.tasks SET external_issue_refresh_attempted_at_ms = NULL
        WHERE org_id = ${ctx.orgId} AND project_id = ${projectId} AND external_system = ${provider}
      `;
      if (futureClock === 'snapshot') {
        await sql`
          UPDATE app.tasks SET external_issue = jsonb_set(external_issue, '{syncedAt}', to_jsonb(${future}::bigint))
          WHERE id = ${tracked.taskId}
        `;
      } else {
        await sql`
          UPDATE app.tasks SET external_issue = jsonb_set(external_issue, '{syncedAt}', to_jsonb(${snapshot.syncedAt}::bigint)),
            external_issue_refresh_attempted_at_ms = ${future}
          WHERE id = ${tracked.taskId}
        `;
      }
      const beforeMixed = await Promise.all(
        [legacy.taskId, tracked.taskId].map((id) =>
          loadTaskOrThrow(sql, id, ctx.orgId),
        ),
      );
      const mixedFirst = await store.listExternalIssues(query);
      const mixedSecond = await store.listExternalIssues(query);
      const afterMixed = await Promise.all(
        [legacy.taskId, tracked.taskId].map((id) =>
          loadTaskOrThrow(sql, id, ctx.orgId),
        ),
      );
      record(
        `external issue: ${provider} mixed legacy and future ${futureClock} clocks rotate fairly`,
        mixedFirst.issues[0]?.taskId === legacy.taskId &&
          mixedSecond.issues[0]?.taskId === tracked.taskId &&
          JSON.stringify(beforeMixed) === JSON.stringify(afterMixed),
        `first legacy=${mixedFirst.issues[0]?.taskId === legacy.taskId}, next tracked=${mixedSecond.issues[0]?.taskId === tracked.taskId}, task and source unchanged=${JSON.stringify(beforeMixed) === JSON.stringify(afterMixed)}`,
      );
    }
    const beforeRefusal =
      await sql`SELECT id, external_issue_refresh_attempted_at_ms, external_issue_source_scopes FROM app.tasks WHERE project_id=${projectId} ORDER BY id`;
    let refused = false;
    try {
      await store.listExternalIssues({
        ...query,
        organizationId: `foreign-${randomUUID()}`,
      });
    } catch (error) {
      refused =
        error instanceof TaskError && error.code === 'PROJECT_NOT_FOUND';
    }
    const afterRefusal =
      await sql`SELECT id, external_issue_refresh_attempted_at_ms, external_issue_source_scopes FROM app.tasks WHERE project_id=${projectId} ORDER BY id`;
    record(
      `external issue: refused ${provider} refresh selection records no attempt`,
      refused && JSON.stringify(beforeRefusal) === JSON.stringify(afterRefusal),
      `refused=${refused}, unchanged=${JSON.stringify(beforeRefusal) === JSON.stringify(afterRefusal)}`,
    );
  }
  const futureAttempt = Date.now() + 60_000;
  await sql`UPDATE app.tasks SET external_issue_refresh_attempted_at_ms = ${futureAttempt} WHERE project_id = ${projectId}`;
  const overlappingSelections = await Promise.all(
    queries.flatMap((query) => [
      store.listExternalIssues({ ...query, limit: 500 }),
      store.listExternalIssues({ ...query, limit: 500 }),
    ]),
  );
  const attempts = await sql<{ attempted: string }[]>`
    SELECT external_issue_refresh_attempted_at_ms AS attempted FROM app.tasks WHERE project_id = ${projectId}
  `;
  record(
    'external issue: overlapping refresh selections keep attempts monotonic after a clock rollback',
    overlappingSelections.every((selection) => selection.issues.length === 2) &&
      attempts.length === 4 &&
      attempts.every((row) => Number(row.attempted) >= futureAttempt + 2) &&
      Math.max(...attempts.map((row) => Number(row.attempted))) ===
        futureAttempt + 4,
    `selections=${overlappingSelections.length}, clocks advanced=${attempts.every((row) => Number(row.attempted) >= futureAttempt + 2)}`,
  );
}
