import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { upsertAgentSecret } from '../domains/agent_secrets/service.ts';

type Request = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<Response>;

/** Real Postgres + authenticated HTTP proof, also runnable without the S3/BM25 suite. */
export async function checkProjectAgentRest(args: {
  sql: Sql;
  orgId: string;
  userId: string;
  rest: Request;
  session: Request;
}): Promise<number> {
  const { sql, orgId, userId, rest, session } = args;
  let checks = 0;
  const expectStatus = async (response: Promise<Response>, status: number) => {
    const result = await response;
    assert.equal(result.status, status);
    checks++;
    return result;
  };
  const roster = z.object({
    agents: z.array(z.looseObject({ id: z.string(), name: z.string() })),
  });
  const agentEnvelope = z.object({
    agent: z.looseObject({
      id: z.string(),
      projectId: z.string(),
      organizationId: z.string(),
      name: z.string(),
      harness: z.string(),
      model: z.string(),
      modelProvider: z.string().nullable(),
      instructions: z.string().nullable(),
      skills: z.array(z.string()),
      connectors: z.array(z.string()),
      tools: z.array(z.string()),
      secrets: z.array(z.string()),
      updatedAt: z.number(),
    }),
  });
  const createProject = async () => {
    const response = await expectStatus(
      rest('POST', '/projects', {
        name: 'Project agent API proof',
        key: `PA${randomBytes(2).toString('hex')}`,
      }),
      201,
    );
    return z
      .object({ project: z.object({ id: z.string() }) })
      .parse(await response.json()).project.id;
  };
  const projectId = await createProject();
  const otherProjectId = await createProject();
  const path = `/projects/${projectId}/agents`;
  const otherPath = `/projects/${otherProjectId}/agents`;
  const config = {
    name: 'Reviewer',
    harness: 'claude-code',
    model: 'test-model',
    skills: [],
    connectors: [],
  };
  const secretName = `PROBE_${randomBytes(6).toString('hex').toUpperCase()}`;
  const secretValue = randomBytes(24).toString('hex');
  await upsertAgentSecret(sql, {
    organizationId: orgId,
    actorId: userId,
    name: secretName,
    value: secretValue,
  });
  const richConfig = {
    ...config,
    modelProvider: 'itestagent',
    instructions: 'Review the task.',
    tools: ['task_find', 'document_find'],
    secrets: [secretName],
  };
  // Equipment is checked against what the organization can serve, and
  // refused by name: a model or provider `GET /models` does not list, a
  // tool grant outside the catalog, a skill or connector nobody has.
  const refusedEquipment: [Record<string, unknown>, string][] = [
    [
      { ...config, model: 'gpt-4-turbo-does-not-exist' },
      'PROJECT_AGENT_MODEL_INVALID',
    ],
    [
      { ...config, modelProvider: 'not-a-real-provider' },
      'PROJECT_AGENT_PROVIDER_UNKNOWN',
    ],
    [
      { ...config, tools: ['bash', 'web_search'] },
      'PROJECT_AGENT_TOOL_UNKNOWN',
    ],
    [
      { ...config, skills: ['not-a-real-skill-xyz'] },
      'PROJECT_AGENT_SKILL_UNKNOWN',
    ],
    [
      { ...config, connectors: ['not-a-real-connector-xyz'] },
      'PROJECT_AGENT_CONNECTOR_UNKNOWN',
    ],
  ];
  for (const [body, code] of refusedEquipment) {
    const refused = await expectStatus(rest('POST', path, body), 400);
    assert.equal(
      z.object({ code: z.string() }).parse(await refused.json()).code,
      code,
    );
  }
  const created = agentEnvelope.parse(
    await (await expectStatus(rest('POST', path, richConfig), 201)).json(),
  ).agent;
  assert.equal(created.projectId, projectId);
  assert.equal(created.organizationId, orgId);
  assert.deepEqual(created.secrets, [secretName]);
  // Tool grants round-trip in catalog order, as the contract says.
  assert.deepEqual(created.tools, ['task_find', 'document_find']);
  assert.equal(created.modelProvider, 'itestagent');
  assert.equal(JSON.stringify(created).includes(secretValue), false);
  const itemPath = `${path}/${created.id}`;
  const listed = roster.parse(
    await (await expectStatus(rest('GET', path), 200)).json(),
  );
  assert.deepEqual(
    listed.agents.map((agent) => agent.id),
    [created.id],
  );
  const appListed = roster.parse(
    await (
      await expectStatus(
        session('GET', `/api/app/projects/${projectId}/agents?orgId=${orgId}`),
        200,
      )
    ).json(),
  );
  assert.deepEqual(
    appListed.agents.map((agent) => agent.id),
    [created.id],
  );
  assert.equal(
    agentEnvelope.parse(
      await (await expectStatus(rest('GET', itemPath), 200)).json(),
    ).agent.id,
    created.id,
  );
  for (const method of ['GET', 'PUT', 'DELETE']) {
    await expectStatus(
      rest(
        method,
        `${otherPath}/${created.id}`,
        method === 'PUT' ? config : undefined,
      ),
      404,
    );
  }
  // A duplicate name (any case) is the 409 every other duplicate answers.
  await expectStatus(rest('POST', path, { ...config, name: 'reviewer' }), 409);
  for (const body of [
    { ...config, projectId: otherProjectId },
    { ...config, agentId: created.id },
    { ...config, harness: 'cursor' },
    { ...config, model: ' ' },
    {
      ...config,
      skills: Array.from({ length: 26 }, (_, index) => `skill-${index}`),
    },
  ])
    await expectStatus(rest('POST', path, body), 400);

  const membership = await sql<
    { role: string }[]
  >`SELECT role FROM "member" WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
  const originalRole = membership[0]?.role;
  assert.ok(originalRole);
  try {
    await sql`UPDATE "member" SET role = 'member' WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    await expectStatus(rest('GET', path), 200);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      await expectStatus(
        rest(
          method,
          method === 'POST' ? path : itemPath,
          method === 'DELETE' ? undefined : config,
        ),
        403,
      );
    }
    await sql`UPDATE "member" SET role = 'editor' WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    await expectStatus(
      rest('PUT', itemPath, { ...richConfig, name: 'Editor review' }),
      200,
    );
    await expectStatus(rest('PUT', itemPath, config), 403);
    await expectStatus(
      rest('POST', path, { ...richConfig, name: 'Forbidden grant' }),
      403,
    );
    await sql`UPDATE app.projects SET team_id = ${randomUUID()} WHERE id = ${otherProjectId}`;
    await expectStatus(rest('GET', otherPath), 404);
    await expectStatus(rest('POST', otherPath, config), 404);
    await sql`UPDATE app.projects SET org_id = ${randomUUID()}, team_id = NULL WHERE id = ${otherProjectId}`;
    await expectStatus(rest('GET', otherPath), 404);
  } finally {
    await sql`UPDATE "member" SET role = ${originalRole} WHERE "organizationId" = ${orgId} AND "userId" = ${userId}`;
    await sql`UPDATE app.projects SET org_id = ${orgId}, team_id = NULL WHERE id = ${otherProjectId}`;
  }

  const saved = agentEnvelope.parse(
    await (await expectStatus(rest('PUT', itemPath, config), 200)).json(),
  ).agent;
  assert.equal(saved.modelProvider, null);
  assert.equal(saved.instructions, null);
  assert.deepEqual(saved.secrets, []);
  // The two silent data-loss modes of the full replace are closed: an
  // unknown secret NAME is refused by name (the app dialog prunes it), and
  // a stale `expectedUpdatedAt` refuses the save with the current stamp.
  const unknownSecret = await expectStatus(
    rest('PUT', itemPath, { ...config, secrets: ['NO_SUCH_SECRET_XYZ'] }),
    400,
  );
  assert.deepEqual(
    z
      .object({
        code: z.string(),
        data: z.object({ secrets: z.array(z.string()) }),
      })
      .parse(await unknownSecret.json()),
    {
      code: 'PROJECT_AGENT_SECRET_UNKNOWN',
      data: { secrets: ['NO_SUCH_SECRET_XYZ'] },
    },
  );
  const stale = await expectStatus(
    rest('PUT', itemPath, { ...config, expectedUpdatedAt: 1 }),
    409,
  );
  assert.deepEqual(
    z
      .object({ code: z.string(), data: z.object({ updatedAt: z.number() }) })
      .parse(await stale.json()),
    { code: 'PROJECT_AGENT_STALE', data: { updatedAt: saved.updatedAt } },
  );
  const conditional = agentEnvelope.parse(
    await (
      await expectStatus(
        rest('PUT', itemPath, {
          ...config,
          name: 'Conditionally saved',
          expectedUpdatedAt: saved.updatedAt,
        }),
        200,
      )
    ).json(),
  ).agent;
  assert.equal(conditional.name, 'Conditionally saved');
  assert.ok(conditional.updatedAt >= saved.updatedAt);
  const appEdited = await expectStatus(
    session('POST', `/api/app/projects/agents/${created.id}?orgId=${orgId}`, {
      ...config,
      name: 'Edited in app',
    }),
    200,
  );
  assert.ok(appEdited.ok);
  const readBack = agentEnvelope.parse(
    await (await expectStatus(rest('GET', itemPath), 200)).json(),
  ).agent;
  assert.equal(readBack.name, 'Edited in app');

  await sql`UPDATE app.projects SET archived_at_ms = ${Date.now()} WHERE id = ${projectId}`;
  await expectStatus(rest('GET', path), 200);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    await expectStatus(
      rest(
        method,
        method === 'POST' ? path : itemPath,
        method === 'DELETE' ? undefined : config,
      ),
      403,
    );
  }
  await expectStatus(
    session(
      'POST',
      `/api/app/projects/agents/${created.id}?orgId=${orgId}`,
      config,
    ),
    403,
  );
  await sql`UPDATE app.projects SET archived_at_ms = NULL WHERE id = ${projectId}`;

  for (const selector of ['agentSlug', 'agentId', 'projectAgentId']) {
    await expectStatus(
      rest('POST', '/threads', { [selector]: created.id }),
      400,
    );
  }
  const thread = z.object({ id: z.string() }).parse(
    await (
      await expectStatus(
        rest('POST', `/projects/${projectId}/threads`, {
          title: 'Project context',
        }),
        201,
      )
    ).json(),
  );
  const threadRead = z
    .looseObject({ projectId: z.string() })
    .parse(
      await (
        await expectStatus(
          rest('GET', `/projects/${projectId}/threads/${thread.id}`),
          200,
        )
      ).json(),
    );
  assert.equal(threadRead.projectId, projectId);
  assert.equal('agentSlug' in threadRead, false);
  await expectStatus(rest('GET', '/agents'), 404);
  await expectStatus(session('GET', `/api/app/agents?orgId=${orgId}`), 404);
  await expectStatus(rest('DELETE', itemPath), 204);
  await expectStatus(rest('DELETE', itemPath), 404);
  await expectStatus(rest('GET', itemPath), 404);
  const rollup = await sql<
    { count: number }[]
  >`SELECT project_agent_count AS count FROM app.projects WHERE id = ${projectId}`;
  assert.equal(rollup[0]?.count, 0);
  return checks;
}
