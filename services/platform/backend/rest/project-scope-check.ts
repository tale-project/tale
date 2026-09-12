import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { createPgTurnStore } from '../domains/chat/store.ts';
import { lockRestProjectForWrite } from './shared.ts';

/** Authenticated HTTP + real SQL proof of the public project's resource boundary.
 * Uses a dedicated actor/organization; no blob or model provider is needed. */
export async function checkProjectResourceRest(args: {
  sql: Sql;
  orgId: string;
  userId: string;
  rest: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
  session: (method: string, path: string, body?: unknown) => Promise<Response>;
  publicRequest: (
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) => Promise<Response>;
}): Promise<number> {
  const { sql, orgId, userId, rest, session } = args;
  let checks = 0;
  const expectStatus = async (
    method: string,
    path: string,
    status: number,
    body?: unknown,
  ) => {
    const response = await rest(method, path, body);
    assert.equal(response.status, status, `${method} ${path}`);
    checks++;
    return response;
  };
  const projectEnvelope = z.object({ project: z.object({ id: z.string() }) });
  const createProject = async (name: string) =>
    projectEnvelope.parse(
      await (
        await expectStatus('POST', '/projects', 201, {
          name,
          key: `RS${randomUUID().slice(0, 4)}`,
        })
      ).json(),
    ).project.id;
  const projectId = await createProject('REST project scope A');
  const otherId = await createProject('REST project scope B');
  const path = `/projects/${projectId}`;
  const otherPath = `/projects/${otherId}`;
  const intake = {
    externalSystem: 'scope-proof',
    externalId: randomUUID(),
    title: 'Scoped task',
  };
  const taskEnvelope = z.object({
    task: z.object({ id: z.string(), created: z.boolean() }),
  });
  const task = taskEnvelope.parse(
    await (await expectStatus('POST', `${path}/tasks`, 201, intake)).json(),
  ).task;
  const repeated = taskEnvelope.parse(
    await (await expectStatus('POST', `${path}/tasks`, 200, intake)).json(),
  ).task;
  assert.equal(repeated.id, task.id);
  assert.equal(repeated.created, false);
  await expectStatus('GET', `${path}/tasks/${task.id}`, 200);
  // A padded repeat of the key is the same task (the ref is canonical).
  const padded = taskEnvelope.parse(
    await (
      await expectStatus('POST', `${path}/tasks`, 200, {
        ...intake,
        externalId: `  ${intake.externalId}\n`,
      })
    ).json(),
  ).task;
  assert.equal(padded.id, task.id);
  // The URL is judged left to right: a bad project id is the project's
  // fault (PROJECT_NOT_FOUND), a bad task id under a good project the
  // task's (TASK_NOT_FOUND).
  const ghost = randomUUID();
  const code = z.object({ code: z.string() });
  assert.equal(
    code.parse(
      await (
        await expectStatus('GET', `/projects/${ghost}/tasks/${ghost}`, 404)
      ).json(),
    ).code,
    'PROJECT_NOT_FOUND',
  );
  assert.equal(
    code.parse(
      await (await expectStatus('GET', `${path}/tasks/${ghost}`, 404)).json(),
    ).code,
    'TASK_NOT_FOUND',
  );
  await expectStatus('POST', '/tasks', 404, { ...intake, projectId });
  await expectStatus('GET', `/tasks/${task.id}`, 404);
  await expectStatus('POST', `${path}/tasks`, 400, {
    ...intake,
    projectId: otherId,
  });
  for (const suffix of ['', '/comments']) {
    await expectStatus('GET', `${otherPath}/tasks/${task.id}${suffix}`, 404);
  }
  await expectStatus('POST', `${otherPath}/tasks/${task.id}/comments`, 404, {
    body: 'Wrong project',
  });
  await expectStatus('POST', `${otherPath}/tasks/${task.id}/start`, 404, {
    workflowSlug: 'scope/probe',
  });
  await expectStatus('POST', `${path}/tasks/${task.id}/comments`, 201, {
    body: 'In the right project',
  });
  const comments = z
    .object({ comments: z.array(z.object({ body: z.string() })) })
    .parse(
      await (
        await expectStatus('GET', `${path}/tasks/${task.id}/comments`, 200)
      ).json(),
    );
  assert.deepEqual(
    comments.comments.map((comment) => comment.body),
    ['In the right project'],
  );

  const threadEnvelope = z.object({ id: z.string() });
  const thread = threadEnvelope.parse(
    await (
      await expectStatus('POST', `${path}/threads`, 201, {
        title: 'Project chat',
      })
    ).json(),
  );
  const unfiled = threadEnvelope.parse(
    await (
      await expectStatus('POST', '/threads', 201, { title: 'Unfiled chat' })
    ).json(),
  );
  const threadList = z.object({
    page: z.array(z.object({ id: z.string() })),
  });
  for (const [collection, present, absent] of [
    [`${path}/threads`, thread.id, unfiled.id],
    ['/threads', unfiled.id, thread.id],
  ] as const) {
    const ids = new Set(
      threadList
        .parse(await (await expectStatus('GET', collection, 200)).json())
        .page.map((row) => row.id),
    );
    assert.ok(ids.has(present));
    assert.ok(!ids.has(absent));
  }
  await expectStatus('POST', '/threads', 400, { projectId });
  await expectStatus('POST', `${path}/threads`, 400, { projectId: otherId });
  for (const suffix of ['', '/messages', '/generation']) {
    await expectStatus('GET', `${path}/threads/${thread.id}${suffix}`, 200);
    await expectStatus('GET', `/threads/${thread.id}${suffix}`, 404);
    await expectStatus(
      'GET',
      `${otherPath}/threads/${thread.id}${suffix}`,
      404,
    );
    await expectStatus('GET', `${path}/threads/${unfiled.id}${suffix}`, 404);
  }
  const message = {
    content: 'This must never be queued',
    model: 'scope-probe',
  };
  await expectStatus('POST', `/threads/${thread.id}/messages`, 404, message);
  await expectStatus(
    'POST',
    `${otherPath}/threads/${thread.id}/messages`,
    404,
    message,
  );
  await expectStatus('POST', `${path}/threads/${thread.id}/messages`, 400, {
    ...message,
    projectId: otherId,
  });
  await expectStatus('POST', `${path}/knowledge/search`, 400, {
    query: 'Scope',
    projectId: otherId,
  });
  await expectStatus('POST', '/knowledge/search', 400, {
    query: 'Scope',
    projectId,
  });

  // Definitions stay organization-owned; install and execution live at a project URL.
  const name = `scope/probe-${randomUUID().slice(0, 8)}`;
  const slug = name.replaceAll('/', '__');
  const saved = await session(
    'POST',
    `/api/app/automations/${name}/save?orgId=${orgId}`,
    {
      document: {
        version: 1,
        name,
        nodes: [
          { id: 'result', type: 'transform', code: 'return { ok: true }' },
        ],
        output: '{{ nodes.result.output }}',
      },
    },
  );
  assert.equal(saved.status, 201);
  const deployed = await session(
    'POST',
    `/api/app/automations/${name}/deploy?orgId=${orgId}`,
    { version: 1 },
  );
  assert.equal(deployed.status, 200);
  const runEnvelope = z.object({ runId: z.string() });
  const globalRun = runEnvelope.parse(
    await (
      await expectStatus('POST', `/automations/${slug}/runs`, 202, {
        mode: 'mock',
        version: 1,
      })
    ).json(),
  );
  await expectStatus('POST', `${path}/automations/${slug}`, 201);
  await expectStatus('POST', `${path}/automations/${slug}`, 200);
  await expectStatus('POST', `/automations/${slug}/projects`, 404, {
    projectId,
  });
  await expectStatus('POST', `${path}/automations/${slug}`, 400, {
    projectId: otherId,
  });
  await expectStatus('POST', `/automations/${slug}/runs`, 400, { projectId });
  await expectStatus('POST', `/automations/${slug}/runs`, 409, {
    mode: 'mock',
    version: 1,
  });
  const run = runEnvelope.parse(
    await (
      await expectStatus('POST', `${path}/automations/${slug}/runs`, 202, {
        mode: 'mock',
        version: 1,
      })
    ).json(),
  );
  const read = z
    .looseObject({ projectId: z.string() })
    .parse(
      await (
        await expectStatus('GET', `${path}/runs/${run.runId}`, 200)
      ).json(),
    );
  assert.equal(read.projectId, projectId);
  await expectStatus('GET', `/runs/${run.runId}`, 404);
  await expectStatus('GET', `${otherPath}/runs/${run.runId}`, 404);
  await expectStatus('GET', `${path}/runs/${globalRun.runId}`, 404);
  await expectStatus('GET', `/runs/${globalRun.runId}`, 200);
  const runsEnvelope = z.object({
    runs: z.array(z.object({ runId: z.string() })),
    isDone: z.boolean(),
    continueCursor: z.string(),
  });
  const projectRuns = runsEnvelope.parse(
    await (
      await expectStatus('GET', `${path}/automations/${slug}/runs`, 200)
    ).json(),
  );
  const globalRuns = runsEnvelope.parse(
    await (await expectStatus('GET', `/automations/${slug}/runs`, 200)).json(),
  );
  assert.ok(projectRuns.runs.some((row) => row.runId === run.runId));
  assert.ok(projectRuns.runs.every((row) => row.runId !== globalRun.runId));
  assert.ok(globalRuns.runs.some((row) => row.runId === globalRun.runId));
  assert.ok(globalRuns.runs.every((row) => row.runId !== run.runId));
  // The all-runs listings cross automations: the project one holds the
  // project run, the organization-wide one every run the key holder can
  // see, each row naming its scope; the org run reads back at the flat URL.
  const projectAll = runsEnvelope.parse(
    await (await expectStatus('GET', `${path}/runs`, 200)).json(),
  );
  const all = runsEnvelope.parse(
    await (await expectStatus('GET', '/runs?include=output', 200)).json(),
  );
  assert.ok(projectAll.runs.some((row) => row.runId === run.runId));
  assert.ok(projectAll.runs.every((row) => row.runId !== globalRun.runId));
  assert.ok(all.runs.some((row) => row.runId === run.runId));
  assert.ok(all.runs.some((row) => row.runId === globalRun.runId));
  await expectStatus('GET', `${path}/runs?status=bogus`, 400);
  await expectStatus('GET', `${path}/runs?limit=abc`, 400);
  const catalog = z.object({
    automations: z.array(z.looseObject({ name: z.string() })),
  });
  const installed = catalog.parse(
    await (await expectStatus('GET', `${path}/automations`, 200)).json(),
  );
  assert.ok(installed.automations.some((row) => row.name === name));
  const definitions = catalog.parse(
    await (await expectStatus('GET', '/automations', 200)).json(),
  );
  // The catalog names the projects an automation is installed in, filtered
  // to what the caller can see: the URL project is listed, the foreign one
  // never leaks through the listing.
  const listed = definitions.automations.find((row) => row.name === name);
  assert.ok(listed !== undefined);
  const installedIn = z.array(z.string()).parse(listed.projectIds);
  assert.ok(installedIn.includes(projectId));
  assert.ok(!installedIn.includes(otherId));
  await expectStatus('POST', `${otherPath}/runs/${run.runId}/cancel`, 404);
  await expectStatus('POST', `/runs/${run.runId}/cancel`, 404);

  const members = await sql<
    { role: string }[]
  >`SELECT role FROM "member" WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
  const originalRole = members[0]?.role;
  assert.ok(originalRole);
  const teamId = randomUUID();
  await sql`INSERT INTO "team" (id, name, "organizationId", "createdAt", "updatedAt") VALUES (${teamId}, 'Private scope proof', ${orgId}, ${new Date()}, ${new Date()})`;
  try {
    await sql`UPDATE "member" SET role = 'member' WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    await expectStatus('GET', `${path}/tasks/${task.id}`, 200);
    await expectStatus('POST', `${path}/tasks`, 403, {
      ...intake,
      externalId: randomUUID(),
    });
    await expectStatus('POST', `${path}/tasks/${task.id}/start`, 403, {
      workflowSlug: name,
    });
    await expectStatus('POST', `${path}/tasks/${task.id}/comments`, 201, {
      body: 'Member collaboration',
    });
    await expectStatus('POST', `${path}/threads`, 201, {
      title: 'Member chat',
    });
    await expectStatus('GET', `${path}/runs/${run.runId}`, 200);
    await expectStatus('POST', `${path}/automations/${slug}/runs`, 403, {
      mode: 'mock',
      version: 1,
    });
    await sql`UPDATE app.projects SET team_id = ${teamId} WHERE id = ${projectId}`;
    for (const resource of [
      '/agents',
      `/tasks/${task.id}`,
      `/tasks/${task.id}/comments`,
      '/threads',
      `/threads/${thread.id}`,
      `/threads/${thread.id}/messages`,
      `/threads/${thread.id}/generation`,
      '/automations',
      `/automations/${slug}/runs`,
      `/runs/${run.runId}`,
      '/files',
      '/folders',
    ]) {
      await expectStatus('GET', `${path}${resource}`, 404);
    }
    await expectStatus('POST', `${path}/knowledge/search`, 404, {
      query: 'Scope',
    });
    await expectStatus(
      'POST',
      `${path}/threads/${thread.id}/messages`,
      404,
      message,
    );
    await sql`UPDATE "member" SET role = 'developer' WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    // The global Hub cannot republish a known upload after its project became
    // private, or steal another user's unbound upload or a chat attachment.
    const stored = await sql<{ id: string }[]>`
      INSERT INTO app.documents (org_id, title, project_id, created_by,
        created_at_ms, updated_at_ms)
      VALUES (${orgId}, 'Private file proof', ${projectId}, ${userId},
        ${Date.now()}, ${Date.now()}) RETURNING id
    `;
    const privateDocumentId = stored[0]?.id;
    assert.ok(privateDocumentId);
    for (const [documentId, threadId, uploadedBy, status] of [
      [privateDocumentId, null, userId, 404],
      [null, thread.id, userId, 404],
      [null, null, 'another-uploader', 404],
      [null, null, userId, 201],
    ] as const) {
      const files = await sql<{ id: string }[]>`
        INSERT INTO app.file_metadata (org_id, file_name, content_type, size,
          storage_ref, uploaded_by, document_id, thread_id, created_at_ms)
        VALUES (${orgId}, 'Scope proof.txt', 'text/plain', 1,
          ${`s3:${orgId}/${randomUUID()}`}, ${uploadedBy}, ${documentId},
          ${threadId}, ${Date.now()}) RETURNING id
      `;
      const fileId = files[0]?.id;
      assert.ok(fileId);
      const response = await expectStatus('POST', '/documents', status, {
        title: 'Hub attachment scope proof',
        fileId,
      });
      if (status === 404) {
        assert.deepEqual(await response.json(), {
          error: 'Upload not found',
          code: 'FILE_NOT_FOUND',
        });
      } else {
        await expectStatus('POST', '/documents', 404, {
          title: 'An upload cannot be published twice',
          fileId,
        });
      }
    }
    for (const tool of ['get_run', 'start_run']) {
      const rpc = z
        .object({
          result: z.object({
            isError: z.boolean(),
            content: z.array(z.object({ text: z.string() })),
          }),
        })
        .parse(
          await (
            await expectStatus('POST', '/mcp', 200, {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: tool,
                // start_run takes no `mode` (the transport refuses a key
                // its schema does not declare); the project scope is what
                // is under test here.
                arguments:
                  tool === 'get_run'
                    ? { runId: run.runId }
                    : { name, version: 1, projectId },
              },
            })
          ).json(),
        ).result;
      // A refusal comes back as data, flagged `isError` so a generic client
      // tells it from success, with the stable code beside the sentence and
      // the hint the dispatcher attaches where it knows the next step.
      if (tool === 'get_run') {
        assert.equal(rpc.isError, true);
        assert.deepEqual(JSON.parse(rpc.content[0]?.text ?? '{}'), {
          error: `no run "${run.runId}"`,
          code: 'RUN_NOT_FOUND',
          hint: 'start_run returns the runId; list_runs lists the recent ones',
        });
      } else {
        assert.equal(rpc.isError, true);
        assert.deepEqual(JSON.parse(rpc.content[0]?.text ?? '{}'), {
          error: 'Project not found.',
          code: 'PROJECT_NOT_FOUND',
        });
      }
    }
  } finally {
    await sql`UPDATE "member" SET role = ${originalRole} WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    await sql`UPDATE app.projects SET team_id = NULL WHERE id = ${projectId}`;
  }
  await sql`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${projectId}`;
  await expectStatus('GET', `${path}/tasks/${task.id}`, 200);
  await expectStatus('GET', `${path}/threads/${thread.id}`, 200);
  await expectStatus('GET', `${path}/runs/${run.runId}`, 200);
  for (const [resource, body] of [
    ['/tasks', { ...intake, externalId: randomUUID() }],
    [`/tasks/${task.id}/comments`, { body: 'Archived write' }],
    ['/threads', { title: 'Archived chat' }],
    [`/automations/${slug}/runs`, { mode: 'mock', version: 1 }],
    [`/runs/${run.runId}/cancel`, {}],
  ] as const) {
    await expectStatus('POST', `${path}${resource}`, 403, body);
  }
  await sql`UPDATE app.projects SET archived_at_ms = NULL WHERE id = ${projectId}`;
  await expectStatus('POST', `${path}/runs/${run.runId}/cancel`, 200);
  await expectStatus('POST', `/runs/${globalRun.runId}/cancel`, 200);

  // A start named by Idempotency-Key is safe to retry: the repeat answers
  // the first run flagged duplicate, a reused key with another body is
  // refused and starts nothing, and a concurrent pair starts exactly one
  // run — the claim is decided by the ledger row, on the real schema.
  const keyed = z.object({
    runId: z.string(),
    duplicate: z.literal(true).optional(),
  });
  const keyedStart = async (key: string, body: unknown, status: number) => {
    const response = await args.rest(
      'POST',
      `${path}/automations/${slug}/runs`,
      body,
      { 'Idempotency-Key': key },
    );
    assert.equal(response.status, status, `Idempotency-Key ${key}`);
    checks++;
    return response;
  };
  const keyBody = { mode: 'mock', version: 1, input: { attempt: 1 } };
  const runsBeforeKeyed = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.automation_runs
    WHERE org_id = ${orgId} AND name = ${name} AND project_id = ${projectId}
  `;
  const firstKeyed = keyed.parse(
    await (await keyedStart('scope-key-1', keyBody, 202)).json(),
  );
  assert.equal(firstKeyed.duplicate, undefined);
  const repeatedKeyed = keyed.parse(
    await (await keyedStart('scope-key-1', keyBody, 202)).json(),
  );
  assert.equal(repeatedKeyed.runId, firstKeyed.runId);
  assert.equal(repeatedKeyed.duplicate, true);
  const reused = await keyedStart(
    'scope-key-1',
    { ...keyBody, input: { attempt: 2 } },
    409,
  );
  assert.equal(
    z.object({ code: z.string() }).parse(await reused.json()).code,
    'IDEMPOTENCY_KEY_REUSED',
  );
  const pair = await Promise.all(
    [0, 1].map(() =>
      args.rest('POST', `${path}/automations/${slug}/runs`, keyBody, {
        'Idempotency-Key': 'scope-key-2',
      }),
    ),
  );
  const pairRuns = await Promise.all(
    pair.map(async (response) => {
      assert.equal(response.status, 202, 'concurrent Idempotency-Key pair');
      checks++;
      return keyed.parse(await response.json());
    }),
  );
  assert.equal(pairRuns[0]?.runId, pairRuns[1]?.runId);
  assert.equal(pairRuns.filter((row) => row.duplicate === true).length, 1);
  const runsAfterKeyed = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM app.automation_runs
    WHERE org_id = ${orgId} AND name = ${name} AND project_id = ${projectId}
  `;
  assert.equal(
    Number(runsAfterKeyed[0]?.count ?? '0') -
      Number(runsBeforeKeyed[0]?.count ?? '0'),
    2,
    'five keyed starts, two runs',
  );

  // A finished run can be removed through the door that created it — in
  // its own scope only, once; the cancelled runs above are terminal.
  await expectStatus('DELETE', `/runs/${run.runId}`, 404);
  await expectStatus('DELETE', `${otherPath}/runs/${run.runId}`, 404);
  await expectStatus('DELETE', `${path}/runs/${run.runId}`, 204);
  await expectStatus('GET', `${path}/runs/${run.runId}`, 404);
  await expectStatus('DELETE', `${path}/runs/${run.runId}`, 404);
  await expectStatus('DELETE', `/runs/${globalRun.runId}`, 204);

  // A move after acceptance must fail at the real transactional write seam,
  // before either a user message or a generation can land in another project.
  const store = createPgTurnStore(sql, { scope: { userId, projectId } });
  await sql`UPDATE app.thread_metadata SET project_id = ${otherId} WHERE thread_id = ${thread.id}`;
  await assert.rejects(
    store.beginTurn({
      organizationId: orgId,
      threadId: thread.id,
      userParts: [
        { type: 'text', text: 'An accepted message cannot follow a move' },
      ],
    }),
    { code: 'THREAD_SCOPE_CHANGED' },
  );
  const messages = await sql<
    { count: number }[]
  >`SELECT count(*)::int AS count FROM app.messages WHERE thread_id = ${thread.id}`;
  assert.equal(messages[0]?.count, 0);
  await sql`UPDATE app.thread_metadata SET project_id = ${projectId} WHERE thread_id = ${thread.id}`;
  const opened = await store.beginTurn({
    organizationId: orgId,
    threadId: thread.id,
    userParts: [
      { type: 'text', text: 'The original project can open the turn' },
    ],
  });
  assert.ok(opened.userMessage?.id);
  assert.ok(opened.assistantMessage.id);
  await store.endGeneration({ organizationId: orgId, threadId: thread.id });

  // Real concurrent transactions: a bind/mint/folder write holds its project
  // active across external I/O. Archival may commit only after that write.
  const projectAuth = {
    organizationId: orgId,
    userId,
    role: 'admin',
    teamIds: [],
  };
  await sql.begin(async (tx) => {
    await lockRestProjectForWrite(tx, projectAuth, projectId);
    await assert.rejects(
      sql.begin(async (archiveTx) => {
        await archiveTx`SET LOCAL lock_timeout = '50ms'`;
        await archiveTx`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${projectId}`;
      }),
      { code: '55P03' },
    );
  });
  await sql`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${projectId}`;
  try {
    await assert.rejects(
      sql.begin((tx) => lockRestProjectForWrite(tx, projectAuth, projectId)),
      { status: 403 },
    );
  } finally {
    await sql`UPDATE app.projects SET archived_at_ms = NULL WHERE id = ${projectId}`;
  }

  // A webhook's token is its sole credential; a project path admits only
  // installed targets, and delivery IDs are independent between projects.
  const trigger = z.object({ token: z.string() }).parse(
    await (
      await expectStatus('PUT', `/automations/${slug}/triggers`, 200, {
        kind: 'webhook',
      })
    ).json(),
  );
  const hook = `/api/projects/${projectId}/automations/webhook/${trigger.token}`;
  const otherHook = `/api/projects/${otherId}/automations/webhook/${trigger.token}`;
  const globalHook = `/api/automations/webhook/${trigger.token}`;
  const deliveryId = randomUUID();
  const deliver = async (url: string, status: number) => {
    const response = await args.publicRequest(
      url,
      { event: 'scope-proof' },
      { 'x-webhook-id': deliveryId },
    );
    assert.equal(response.status, status, 'token webhook scope');
    checks++;
    return response;
  };
  // The flat URL refuses a bound automation with the REST door's 409; a
  // project the automation is not installed in is the one uninformative
  // 403 (so is an archived one below); the query selector stays a 400.
  await deliver(globalHook, 409);
  await deliver(`${hook}?projectId=${otherId}`, 400);
  const notInstalled = await deliver(otherHook, 403);
  assert.deepEqual(await notInstalled.json(), {
    error: 'The automation cannot run in that project.',
    code: 'AUTOMATION_PROJECT_FORBIDDEN',
  });
  const acceptedHook = runEnvelope.parse(
    await (await deliver(hook, 202)).json(),
  );
  const replayHook = z
    .object({ runId: z.string(), duplicate: z.literal(true) })
    .parse(await (await deliver(hook, 202)).json());
  assert.equal(replayHook.runId, acceptedHook.runId);
  await expectStatus('GET', `${path}/runs/${acceptedHook.runId}`, 200);
  await expectStatus('GET', `/runs/${acceptedHook.runId}`, 404);
  await expectStatus('POST', `${otherPath}/automations/${slug}`, 201);
  const otherAccepted = runEnvelope.parse(
    await (await deliver(otherHook, 202)).json(),
  );
  assert.notEqual(otherAccepted.runId, acceptedHook.runId);
  await expectStatus('GET', `${otherPath}/runs/${otherAccepted.runId}`, 200);
  await sql`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${projectId}`;
  try {
    await deliver(hook, 403);
  } finally {
    await sql`UPDATE app.projects SET archived_at_ms = NULL WHERE id = ${projectId}`;
  }
  return checks;
}
