import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { getProjectAuthContext } from '../projects/service.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import { readableProjectIds } from './project-visibility.ts';
import { AutomationError, beginRun, setAutomationProjects } from './store.ts';
/** Real HTTP sessions and PostgreSQL proof of automation project visibility.
 * Synthetic waiting runs have no jobs, so a worker cannot finish the fixture
 * before a read, answer or cancel. No vendor, harness or browser is involved. */
import { markAutomationWriterInTx } from './writer-protocol.ts';

const responseSchema = z.looseObject({
  error: z.string().optional(),
  runId: z.string().optional(),
  cancelled: z.boolean().optional(),
  run: z.looseObject({ id: z.string() }).optional(),
  runs: z.array(z.looseObject({ id: z.string() })).optional(),
  ask: z
    .looseObject({ askId: z.string(), runId: z.string() })
    .nullable()
    .optional(),
  projectIds: z.array(z.string()).optional(),
  automations: z
    .array(z.looseObject({ name: z.string(), projectIds: z.array(z.string()) }))
    .optional(),
});

async function waitsForWriter(sql: Sql, pid: number): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await sql<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND ${pid}::int = ANY(pg_blocking_pids(pid))
      ) AS waiting
    `;
    if (row?.waiting) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function checkAutomationProjectVisibility(
  sql: Sql,
  base: string,
  ctx: { orgId: string; userId: string; cookie: string },
  member: { userId: string; cookie: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const now = Date.now();
  const teamId = randomUUID();
  const foreignOrg = randomUUID();
  const shared = randomUUID();
  const hidden = randomUUID();
  const archived = randomUUID();
  const foreign = randomUUID();
  const prefix = `itest-visibility-${randomUUID()}`;
  const names = {
    unbound: `${prefix}/unbound`,
    shared: `${prefix}/shared`,
    hidden: `${prefix}/hidden`,
    mixed: `${prefix}/mixed`,
    archived: `${prefix}/archived`,
    lateBound: `${prefix}/late-bound`,
  };
  const request = async (
    route: string,
    body?: unknown,
    cookie = member.cookie,
  ) => {
    const response = await fetch(
      `${base}/api/app/automations${route}${route.includes('?') ? '&' : '?'}orgId=${orgId}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, origin: base, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const text = await response.text();
    return {
      status: response.status,
      data: responseSchema.parse(JSON.parse(text)),
      text,
    };
  };
  await sql`
    INSERT INTO "team" (id, name, "organizationId", "createdAt")
    VALUES (${teamId}, 'Automation private team', ${orgId}, now())
  `;
  for (const [id, organizationId, restricted, retired] of [
    [shared, orgId, false, false],
    [hidden, orgId, true, false],
    [archived, orgId, false, true],
    [foreign, foreignOrg, false, false],
  ] as const) {
    await sql`
      INSERT INTO app.projects (
        id, org_id, name, team_ids, created_by, created_at_ms,
        updated_at_ms, archived_at_ms
      ) VALUES (
        ${id}, ${organizationId}, 'Automation visibility fixture',
        ${restricted ? [teamId] : []}::text[], ${userId}, ${now}, ${now},
        ${retired ? now : null}
      )
    `;
  }
  for (const [kind, name] of Object.entries(names)) {
    await sql`
      INSERT INTO app.automations (
        org_id, name, version, document, created_by, created_at_ms
      ) VALUES (
        ${orgId}, ${name}, 1,
        ${sql.json({ version: 1, name, nodes: [{ id: 'echo', type: 'transform', code: 'return null;' }] })},
        ${userId}, ${now}
      )
    `;
    await sql`
      INSERT INTO app.automation_deployments (
        org_id, name, version, deployed_by, deployed_at_ms
      ) VALUES (${orgId}, ${name}, 1, ${userId}, ${now})
    `;
    const projects =
      kind === 'mixed'
        ? [shared, hidden]
        : kind === 'hidden'
          ? [hidden]
          : kind === 'archived'
            ? [archived]
            : kind === 'shared'
              ? [shared]
              : [];
    for (const projectId of projects) {
      await sql`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_by, bound_at_ms
        ) VALUES (${orgId}, ${name}, ${projectId}, ${userId}, ${now})
      `;
    }
  }
  const seedRun = async (projectId: string | null, organizationId = orgId) => {
    const id = randomUUID();
    await sql.begin(async (fixtureTx) => {
      await markAutomationWriterInTx(fixtureTx);
      return fixtureTx`
      INSERT INTO app.automation_runs (
        id, org_id, project_id, name, version, status, mode, started_by,
        input, checkpoints, started_at_ms
      ) VALUES (
        ${id}, ${organizationId}, ${projectId}, ${names.mixed}, 1,
        'waiting', 'mock', ${`user:${userId}`},
        ${sql.json({ secret: projectId === hidden ? 'private-run-input' : 'visible' })},
        ${sql.json({ nodes: {}, executions: 0 })}, ${projectId === hidden ? now + 1 : now}
      )
    `;
    });
    return id;
  };
  const seedAsk = async (runId: string, organizationId = orgId) => {
    const id = randomUUID();
    await sql`
      INSERT INTO app.automation_human_asks (
        id, org_id, run_id, node_id, session_id, exec_id, question,
        status, expires_at_ms, created_at_ms
      ) VALUES (
        ${id}, ${organizationId}, ${runId}, 'question', ${id}, ${id},
        'Private question?', 'pending', ${now + 3_600_000}, ${now}
      )
    `;
    return id;
  };
  const orgRun = await seedRun(null);
  const sharedRun = await seedRun(shared);
  const hiddenRun = await seedRun(hidden);
  const archivedRun = await seedRun(archived);
  const foreignRun = await seedRun(foreign, foreignOrg);
  const hiddenAsk = await seedAsk(hiddenRun);
  const sharedAsk = await seedAsk(sharedRun);
  const foreignAsk = await seedAsk(foreignRun, foreignOrg);
  const visibleRuns: string[] = [orgRun, sharedRun, archivedRun];

  for (const runId of visibleRuns) {
    const response = await request(`/runs/${runId}`);
    record(
      'automation member reads organization, shared and archived project runs',
      response.status === 200 && response.data.run?.id === runId,
      `run=${runId}, status=${response.status}`,
    );
  }
  for (const runId of [hiddenRun, foreignRun, randomUUID()]) {
    const response = await request(`/runs/${runId}`);
    const question = await request(`/runs/${runId}/ask`);
    const cancel = await request(`/runs/${runId}/cancel`, {});
    record(
      'automation hidden, foreign and missing runs reveal no content or question and cannot cancel',
      response.status === 404 &&
        !response.text.includes('private-run-input') &&
        question.data.ask === null &&
        cancel.data.cancelled === false,
      `read=${response.status}, ask=${JSON.stringify(question.data.ask)}, cancel=${cancel.data.cancelled}`,
    );
  }
  for (const askId of [hiddenAsk, foreignAsk, randomUUID()]) {
    const response = await request(`/asks/${askId}/answer`, {
      answer: 'blocked',
    });
    record(
      'automation hidden, foreign and missing questions cannot be answered',
      response.status === 404 && response.data.error === 'HUMAN_ASK_NOT_FOUND',
      `status=${response.status}, code=${response.data.error}`,
    );
  }
  const untouched = await sql<{ status: string; answer: string | null }[]>`
    SELECT status, answer FROM app.automation_human_asks
    WHERE id = ANY(${[hiddenAsk, foreignAsk]}::text[])
  `;
  record(
    'refused automation answers leave persisted questions pending',
    untouched.length === 2 &&
      untouched.every((row) => row.status === 'pending' && row.answer === null),
    JSON.stringify(untouched),
  );

  const listed = await request(`/runs?name=${encodeURIComponent(names.mixed)}`);
  const one = await request(
    `/runs?name=${encodeURIComponent(names.mixed)}&limit=1`,
  );
  const scoped = await request(`/runs?projectId=${hidden}`);
  record(
    'automation run SQL filters private projects before the page limit and retains archived history',
    listed.data.runs?.length === 3 &&
      listed.data.runs.every((run) => visibleRuns.includes(run.id)) &&
      one.data.runs?.length === 1 &&
      visibleRuns.includes(one.data.runs[0]?.id ?? '') &&
      scoped.data.runs?.length === 0,
    `listed=${listed.data.runs?.map((run) => run.id).join()}, first=${one.data.runs?.[0]?.id}, scoped=${scoped.data.runs?.length}`,
  );
  const listing = await request('/listing?includeProjectBound=true');
  const bindings = await request(`/${names.mixed}/projects`);
  const hiddenListing = await request(`/listing?projectId=${hidden}`);
  record(
    'automation app binding lists expose readable projects only',
    listing.data.automations
      ?.find((item) => item.name === names.mixed)
      ?.projectIds.join() === shared &&
      bindings.data.projectIds?.join() === shared &&
      hiddenListing.data.automations?.length === 0 &&
      !listing.text.includes(hidden) &&
      // Bound only to a hidden project: left out, not listed as org scope.
      !listing.data.automations?.some((item) => item.name === names.hidden),
    `mixed=${bindings.data.projectIds?.join()}, hidden listing=${hiddenListing.data.automations?.length}, hidden-only listed=${listing.data.automations?.some((item) => item.name === names.hidden)}`,
  );

  const engine = pgAutomationStore(sql, {
    organizationId: orgId,
    actor: member.userId,
  });
  const engineRuns = await engine.listRuns?.({ name: names.mixed });
  const engineHidden = await engine.getRun?.(hiddenRun);
  const engineList = await engine.list();
  record(
    'automation engine uses the same actual project SQL for runs and binding IDs',
    engineRuns?.length === 3 &&
      engineRuns.every((run) => visibleRuns.includes(run.id)) &&
      engineHidden === null &&
      engineList
        .find((item) => item.name === names.mixed)
        ?.projectIds?.join() === shared &&
      !engineList.some((item) => item.name === names.hidden),
    `runs=${engineRuns?.length}, hidden=${JSON.stringify(engineHidden)}, bindings=${engineList.find((item) => item.name === names.mixed)?.projectIds?.join()}`,
  );

  const beforeStarts = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.automation_runs WHERE org_id = ${orgId} AND name LIKE ${`${prefix}/%`}
  `;
  for (const [name, projectId, code] of [
    [names.hidden, hidden, 'PROJECT_NOT_FOUND'],
    [names.unbound, foreign, 'PROJECT_NOT_FOUND'],
    [names.unbound, archived, 'PROJECT_ARCHIVED'],
    [names.hidden, undefined, 'PROJECT_NOT_FOUND'],
    [names.mixed, undefined, 'PROJECT_NOT_FOUND'],
    [names.archived, undefined, 'PROJECT_ARCHIVED'],
  ] as const) {
    const response = await request(`/${name}/start`, {
      mode: 'mock',
      ...(projectId === undefined ? {} : { projectId }),
    });
    record(
      'automation start refuses hidden explicit or inferred scope and archived writes',
      response.status === (code === 'PROJECT_ARCHIVED' ? 403 : 404) &&
        response.data.error === code,
      `name=${name}, scope=${projectId ?? 'inferred'}, status=${response.status}, code=${response.data.error}`,
    );
  }
  const afterStarts = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.automation_runs WHERE org_id = ${orgId} AND name LIKE ${`${prefix}/%`}
  `;
  record(
    'refused scoped automation starts enqueue no run',
    beforeStarts[0]?.count === afterStarts[0]?.count,
    `before=${beforeStarts[0]?.count}, after=${afterStarts[0]?.count}`,
  );
  // Hold the admission's binding read after its route-level visibility
  // lookup, then bind the previously unbound automation to a hidden project.
  // The store must validate what it resolves, not only the request body.
  let bindingWaited = false;
  let lateStart: Promise<Awaited<ReturnType<typeof request>>> | undefined;
  await sql.begin(async (tx) => {
    const [writer] = await tx<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    await tx`LOCK TABLE app.automation_project_bindings IN ACCESS EXCLUSIVE MODE`;
    lateStart = request(`/${names.lateBound}/start`, { mode: 'mock' });
    bindingWaited = await waitsForWriter(sql, writer?.pid ?? 0);
    await tx`
      INSERT INTO app.automation_project_bindings (
        org_id, automation_name, project_id, bound_by, bound_at_ms
      ) VALUES (${orgId}, ${names.lateBound}, ${hidden}, ${userId}, ${now})
    `;
  });
  const late = await lateStart;
  const [lateRuns] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.automation_runs
    WHERE org_id = ${orgId} AND name = ${names.lateBound}
  `;
  record(
    'a hidden binding committed while admission waits cannot start a run',
    bindingWaited &&
      late?.status === 404 &&
      late.data.error === 'PROJECT_NOT_FOUND' &&
      lateRuns?.count === 0,
    `observed lock=${bindingWaited}, status=${late?.status}, runs=${lateRuns?.count}`,
  );
  for (const [name, projectId, expected] of [
    [names.unbound, undefined, null],
    [names.shared, undefined, shared],
    [names.mixed, shared, shared],
  ] as const) {
    const response = await request(`/${name}/start`, {
      mode: 'mock',
      ...(projectId === undefined ? {} : { projectId }),
    });
    const rows = await sql<{ projectId: string | null }[]>`
      SELECT project_id AS "projectId" FROM app.automation_runs
      WHERE org_id = ${orgId} AND id = ${response.data.runId ?? ''}
    `;
    record(
      'automation visible and unbound starts retain their persisted scope',
      response.status === 201 && rows[0]?.projectId === expected,
      `status=${response.status}, scope=${rows[0]?.projectId}, expected=${expected}`,
    );
  }

  // A row-level race: the initial ownership read sees the committed shared
  // run. A competing writer changes its run while the answer's locked read
  // waits. PostgreSQL must recheck the pinned run predicate after the wait.
  // Driven as the owner so the request passes the run's write gate and
  // actually reaches the pinned `FOR UPDATE` — the run pin, not the write
  // gate, is what must stop the answer crossing to the other run.
  let held = false;
  let answer: Promise<Awaited<ReturnType<typeof request>>> | undefined;
  await sql.begin(async (tx) => {
    const [owner] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx`UPDATE app.automation_human_asks SET run_id = ${hiddenRun} WHERE id = ${sharedAsk}`;
    answer = request(
      `/asks/${sharedAsk}/answer`,
      { answer: 'must not cross runs' },
      ctx.cookie,
    );
    held = await waitsForWriter(sql, owner?.pid ?? 0);
  });
  const raced = await answer;
  const [raceRow] = await sql<
    { runId: string; status: string; answer: string | null }[]
  >`
    SELECT run_id AS "runId", status, answer FROM app.automation_human_asks WHERE id = ${sharedAsk}
  `;
  record(
    'an answer waiting on a changed ask cannot cross the authorized run',
    held &&
      raced?.status === 404 &&
      raceRow?.runId === hiddenRun &&
      raceRow.status === 'pending' &&
      raceRow.answer === null,
    `observed lock=${held}, status=${raced?.status}, row=${JSON.stringify(raceRow)}`,
  );

  const ownerRead = await request(`/runs/${hiddenRun}`, undefined, ctx.cookie);
  await sql`
    INSERT INTO "teamMember" (id, "teamId", "userId", "createdAt")
    VALUES (gen_random_uuid(), ${teamId}, ${member.userId}, now())
  `;
  // A read-only member (role 'member') joins the private team: they may now
  // READ the run and its question, but cancelling and answering are WRITES —
  // the app door must not bypass the project write gate the REST and task
  // doors enforce, so both refuse and leave the run and ask untouched.
  const joined = await request(`/runs/${hiddenRun}`);
  const joinedQuestion = await request(`/runs/${hiddenRun}/ask`);
  const readOnlyAnswer = await request(`/asks/${hiddenAsk}/answer`, {
    answer: 'must be refused',
  });
  const readOnlyCancel = await request(`/runs/${hiddenRun}/cancel`, {});
  const [afterReadOnly] = await sql<
    { status: string; answer: string | null }[]
  >`
    SELECT r.status, a.answer FROM app.automation_human_asks a
    JOIN app.automation_runs r ON r.id = a.run_id
    WHERE a.id = ${hiddenAsk}
  `;
  record(
    'a read-only audience member reads the run but the write gate refuses cancel and answer',
    ownerRead.status === 200 &&
      joined.status === 200 &&
      joinedQuestion.data.ask?.runId === hiddenRun &&
      readOnlyAnswer.status === 403 &&
      readOnlyCancel.status === 403 &&
      afterReadOnly?.status === 'waiting' &&
      afterReadOnly.answer === null,
    `owner=${ownerRead.status}, joined=${joined.status}, answer=${readOnlyAnswer.status}, cancel=${readOnlyCancel.status}, run=${afterReadOnly?.status}, answer=${afterReadOnly?.answer}`,
  );
  // Promote the same member to an editor (a project writer): control is now
  // permitted — the read-versus-control distinction, not mere audience.
  await sql`
    UPDATE "member" SET "role" = 'editor'
    WHERE "organizationId" = ${orgId} AND "userId" = ${member.userId}
  `;
  const answered = await request(`/asks/${hiddenAsk}/answer`, {
    answer: 'visible now',
  });
  const cancelled = await request(`/runs/${hiddenRun}/cancel`, {});
  const [storedAnswer] = await sql<
    { answer: string | null; answeredBy: string | null }[]
  >`
    SELECT answer, answered_by AS "answeredBy" FROM app.automation_human_asks WHERE id = ${hiddenAsk}
  `;
  record(
    'admin and a project-writer member can read and act on the private run',
    answered.status === 200 &&
      cancelled.data.cancelled === true &&
      storedAnswer?.answer === 'visible now' &&
      storedAnswer.answeredBy === member.userId,
    `answer=${answered.status}, cancel=${cancelled.data.cancelled}, actor=${storedAnswer?.answeredBy}`,
  );
  await sql`
    UPDATE "member" SET "role" = 'member'
    WHERE "organizationId" = ${orgId} AND "userId" = ${member.userId}
  `;
  await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId} AND "userId" = ${member.userId}`;
  const revoked = await request(`/runs/${hiddenRun}`);
  const revokedList = await request(
    `/runs?name=${encodeURIComponent(names.mixed)}`,
  );
  record(
    'new requests re-read team membership after access is removed',
    revoked.status === 404 &&
      !revokedList.data.runs?.some((run) => run.id === hiddenRun),
    `read=${revoked.status}, hidden listed=${revokedList.data.runs?.some((run) => run.id === hiddenRun)}`,
  );

  // A trigger start is not held to the app's inferred-scope checks: an event
  // dispatch starts every listening automation in one savepoint, so a sole
  // binding to an archived project must not refuse (and roll back) them.
  const triggered = await beginRun(sql, {
    organizationId: orgId,
    name: names.archived,
    input: {},
    mode: 'mock',
    startedBy: `trigger:${randomUUID()}`,
  });
  const [triggeredRow] = await sql<{ projectId: string | null }[]>`
    SELECT project_id AS "projectId" FROM app.automation_runs
    WHERE org_id = ${orgId} AND id = ${triggered?.runId ?? ''}
  `;
  record(
    'a trigger start keeps its inferred sole binding without the app refusal',
    triggeredRow?.projectId === archived,
    `scope=${triggeredRow?.projectId}`,
  );

  // Saving bindings for someone who cannot read every bound project keeps
  // the bindings outside their view; one they cannot read and that is not
  // bound answers like a missing project.
  const memberView = await readableProjectIds(
    sql,
    await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: member.userId,
      role: 'member',
    }),
  );
  await setAutomationProjects(sql, {
    organizationId: orgId,
    name: names.mixed,
    projectIds: [],
    actor: member.userId,
    visibleProjectIds: memberView,
  });
  const kept = await sql<{ projectId: string }[]>`
    SELECT project_id AS "projectId" FROM app.automation_project_bindings
    WHERE org_id = ${orgId} AND automation_name = ${names.mixed}
  `;
  const refusal = await setAutomationProjects(sql, {
    organizationId: orgId,
    name: names.unbound,
    projectIds: [hidden],
    actor: member.userId,
    visibleProjectIds: memberView,
  }).then(
    () => 'saved',
    (error: unknown) =>
      error instanceof AutomationError ? error.code : String(error),
  );
  record(
    'a binding save within a partial view keeps hidden bindings',
    !memberView.includes(hidden) &&
      kept.map((row) => row.projectId).join() === hidden &&
      refusal === 'AUTOMATION_PROJECT_UNKNOWN',
    `kept=${kept.map((row) => row.projectId).join()}, refusal=${refusal}`,
  );
}
