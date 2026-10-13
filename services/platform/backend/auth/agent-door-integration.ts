/**
 * Real Postgres and HTTP proof of a coding agent at the MCP endpoint: the
 * token the sign-in server issues opens the endpoint as the person who
 * connected the agent, in the organization they chose and with the role they
 * have now, and only while its connection lives; what the person allowed
 * narrows what the agent may call — a request that needs more is refused
 * whole with the challenge that tells the agent what to ask for, and a call
 * its person's role could never allow is refused as a tool error; a call
 * names the connection in the audit log and in the counters; and a token
 * opens no route but this one. The tokens, keys and rows are the real
 * provider's, so this is where the door's checks meet them.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { DOC_EXAMPLE } from '../../lib/engine/api/docs.ts';
import { listAgentConnections } from '../domains/agent_connections/service.ts';
import { type RecordCheck, signUpUser } from '../integration-lane-helpers.ts';
import { agentFlow } from './agent-flow-integration.ts';
import { DOCUMENT_URL } from './agent-oauth-integration.ts';
import { configuredMcpResources, seedMcpResources } from './agent-oauth.ts';
import { removeMembershipCascade } from './membership.ts';

const EDIT = 'tale:mcp tale:automations.write offline_access';
const READ_SETTINGS = 'tale:mcp tale:settings.read offline_access';

export async function checkAgentDoor(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const issuer = `${base}/api/auth`;
  const mcp = `${base}/api/v1/mcp`;
  const savedSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = base;
  const headers = { 'content-type': 'application/json', origin: base };
  try {
    await seedMcpResources(sql, configuredMcpResources());
    const owner = await signUpUser(base, `door-owner-${suffix}`);
    const dev = await signUpUser(base, `door-dev-${suffix}`);
    const holder = await signUpUser(base, `door-holder-${suffix}`);
    await sql`
      UPDATE "user" SET "emailVerified" = true
      WHERE "id" = ANY(${[owner.userId, dev.userId, holder.userId]})
    `;
    const createOrg = async (cookie: string, slug: string) =>
      z.object({ id: z.string() }).parse(
        await (
          await fetch(`${base}/api/auth/organization/create`, {
            method: 'POST',
            headers: { ...headers, cookie },
            body: JSON.stringify({ name: `Agent door ${slug}`, slug }),
          })
        ).json(),
      ).id;
    const acmeSlug = `agent-door-acme-${suffix}`;
    const betaSlug = `agent-door-beta-${suffix}`;
    const acme = await createOrg(owner.cookie, acmeSlug);
    const beta = await createOrg(dev.cookie, betaSlug);
    const join = (userId: string, role: string) =>
      sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
        VALUES (gen_random_uuid(), ${acme}, ${userId}, ${role}, ${new Date()})
      `;
    await join(dev.userId, 'developer');
    await join(holder.userId, 'member');
    await sql`
      INSERT INTO app.competence_records (
        org_id, user_id, competence, granted_by, granted_at_ms
      ) VALUES (
        ${acme}, ${holder.userId}, 'tale:models.api', ${owner.userId},
        ${Date.now()}
      )
    `;
    const setRole = (userId: string, role: string) =>
      sql`
        UPDATE "member" SET "role" = ${role}
        WHERE "organizationId" = ${acme} AND "userId" = ${userId}
      `;
    const flow = agentFlow({
      base,
      organizationId: acme,
      defaultScope: EDIT,
    });
    /** A person connects the agent and the agent exchanges its code. */
    const connect = async (cookie: string, scope: string = EDIT) => {
      const allowed = await flow.allow(cookie, {}, scope);
      const exchanged = await flow.exchange(allowed);
      return flow.tokensOf(exchanged.body);
    };
    const connectionOf = async (userId: string) =>
      (
        await sql<{ id: string; createdAt: number }[]>`
          SELECT id, created_at_ms::float8 AS "createdAt"
          FROM app.agent_connections
          WHERE org_id = ${acme} AND user_id = ${userId}
            AND client_id = ${DOCUMENT_URL} AND revoked_at_ms IS NULL
        `
      )[0];

    /** One request to the MCP endpoint, as the agent sends it. */
    const call = async (
      bearer: string | null,
      message: unknown,
      extra: Record<string, string> = {},
    ) => {
      const response = await fetch(mcp, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
          ...extra,
        },
        body: JSON.stringify(message),
      });
      const text = await response.text();
      return {
        status: response.status,
        challenge: response.headers.get('www-authenticate'),
        body: text === '' ? null : (JSON.parse(text) as unknown),
      };
    };
    const tool = (name: string, args: unknown, id = 1) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    /** The JSON a tool result carries, and whether it is an error. */
    const result = (body: unknown) => {
      const parsed = z
        .object({
          result: z.object({
            isError: z.boolean(),
            content: z.array(z.object({ text: z.string() })),
          }),
        })
        .safeParse(body);
      if (!parsed.success) return null;
      const value: unknown = JSON.parse(
        parsed.data.result.content[0]?.text ?? 'null',
      );
      const shaped = z
        .looseObject({
          code: z.string().optional(),
          hint: z.string().optional(),
        })
        .safeParse(value);
      return {
        isError: parsed.data.result.isError,
        value,
        code: shaped.success ? shaped.data.code : undefined,
        hint: shaped.success ? shaped.data.hint : undefined,
      };
    };
    const insufficient = z.looseObject({
      code: z.literal('INSUFFICIENT_SCOPE'),
      data: z.looseObject({
        tools: z.array(z.string()),
        requiredScopes: z.array(z.string()),
        grantedScopes: z.array(z.string()),
      }),
    });
    const automation = `agent-door-${suffix}`;
    const versionsOf = async () =>
      (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.automations
          WHERE org_id = ${acme} AND name = ${automation}
        `
      )[0]?.n ?? -1;

    // The token the sign-in server issues opens the endpoint.
    const devTokens = await connect(dev.cookie);
    const devConnection = await connectionOf(dev.userId);
    const initialized = await call(devTokens.access_token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    const listed = await call(devTokens.access_token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const toolCount = z
      .object({ result: z.object({ tools: z.array(z.unknown()) }) })
      .safeParse(listed.body);
    const usage = await sql<{ kind: string; id: string; calls: number }[]>`
      SELECT credential_kind AS kind, credential_id AS id,
             sum(calls)::int AS calls
      FROM app.mcp_client_activity
      WHERE org_id = ${acme} AND user_id = ${dev.userId}
      GROUP BY credential_kind, credential_id
    `;
    const shown = await listAgentConnections(sql, {
      organizationId: acme,
      viewerId: dev.userId,
      viewerRole: 'developer',
    });
    record(
      'agent door: the token the sign-in server issues opens the endpoint as the person who connected the agent, and the calls are counted under the connection, which is where its last use is read from (AGCONN-R11, AGCONN-R15)',
      initialized.status === 200 &&
        listed.status === 200 &&
        toolCount.success &&
        toolCount.data.result.tools.length >= 30 &&
        devConnection !== undefined &&
        usage.length === 1 &&
        usage[0]?.kind === 'oauth' &&
        usage[0].id === devConnection.id &&
        (usage[0]?.calls ?? 0) >= 2 &&
        (shown.connections[0]?.lastUsedAt ?? 0) > Date.now() - 60_000,
      `initialize=${initialized.status}, list=${listed.status}, tools=${toolCount.success ? toolCount.data.result.tools.length : 'ERR'}, usage=${JSON.stringify(usage)}, last used=${String(shown.connections[0]?.lastUsedAt)}`,
    );

    // What the person allowed narrows what the agent calls.
    const saved = await call(
      devTokens.access_token,
      tool('save_automation', {
        automation: { ...DOC_EXAMPLE.automation, name: automation },
        message: 'saved by the lane agent',
      }),
    );
    const savedResult = result(saved.body);
    const savedRow = (
      await sql<
        { via: string | null; keyId: string | null; client: string | null }[]
      >`
        SELECT created_via AS via, api_key_id AS "keyId", client_name AS client
        FROM app.automations
        WHERE org_id = ${acme} AND name = ${automation}
        ORDER BY version DESC LIMIT 1
      `
    )[0];
    const auditRows = await sql<
      {
        actor: string;
        via: string | null;
        tool: string | null;
        client: string | null;
        key: string | null;
      }[]
    >`
      SELECT actor_id AS actor, metadata->>'via' AS via,
             metadata->>'tool' AS tool, metadata->>'clientName' AS client,
             metadata->>'apiKeyId' AS key
      FROM app.audit_logs
      WHERE org_id = ${acme}
        AND metadata->>'agentConnectionId' = ${devConnection?.id ?? ''}
    `;
    record(
      'agent door: a connection allowed to edit saves a version as its person through the MCP door — the version and the audit row name the app and the connection, and no key (MCP-R40, MCP-R42)',
      saved.status === 200 &&
        savedResult?.isError === false &&
        savedRow?.via === 'mcp' &&
        savedRow.keyId === null &&
        savedRow.client === 'Lane Agent' &&
        auditRows.length > 0 &&
        auditRows.every(
          (row) =>
            row.actor === dev.userId &&
            row.via === 'mcp' &&
            row.client === 'Lane Agent' &&
            row.key === null,
        ) &&
        auditRows.some((row) => row.tool === 'save_automation'),
      `save=${saved.status} ${JSON.stringify(savedResult)?.slice(0, 160)}, row=${JSON.stringify(savedRow)}, audit=${JSON.stringify(auditRows)}`,
    );

    const deploy = await call(
      devTokens.access_token,
      tool('deploy_automation', { name: automation, version: 1 }),
    );
    const deployBody = insufficient.safeParse(deploy.body);
    const versionsBefore = await versionsOf();
    const batch = await call(devTokens.access_token, [
      tool(
        'save_automation',
        {
          automation: { ...DOC_EXAMPLE.automation, name: automation },
          message: 'must not be saved',
        },
        1,
      ),
      tool('deploy_automation', { name: automation, version: 1 }, 2),
    ]);
    const readOnlyRefusals = await sql<{ refusals: number }[]>`
      SELECT coalesce(sum(refusals), 0)::int AS refusals
      FROM app.mcp_client_activity
      WHERE org_id = ${acme} AND credential_id = ${devConnection?.id ?? ''}
        AND tool = 'deploy_automation'
    `;
    record(
      'agent door: a request that needs access the connection lacks is refused whole with the challenge that names what to ask for — nothing in it runs, even the call the connection could make — and the refusal is counted (MCP-R40, MCP-R41)',
      deploy.status === 403 &&
        deployBody.success &&
        deployBody.data.data.requiredScopes.join() ===
          'tale:automations.deploy' &&
        deployBody.data.data.grantedScopes.join() ===
          'offline_access,tale:automations.write,tale:mcp' &&
        (deploy.challenge ?? '').startsWith(
          'Bearer error="insufficient_scope"',
        ) &&
        (deploy.challenge ?? '').includes(
          'scope="tale:mcp tale:automations.write tale:automations.deploy offline_access"',
        ) &&
        (deploy.challenge ?? '').includes(
          `resource_metadata="${base}/.well-known/oauth-protected-resource/api/v1/mcp"`,
        ) &&
        batch.status === 403 &&
        (await versionsOf()) === versionsBefore &&
        (readOnlyRefusals[0]?.refusals ?? 0) >= 1,
      `deploy=${deploy.status} ${JSON.stringify(deploy.body)?.slice(0, 200)}, challenge=${deploy.challenge}, batch=${batch.status}, versions ${versionsBefore}→${await versionsOf()}, counted=${JSON.stringify(readOnlyRefusals)}`,
    );

    // A connection works in the organization it was made for.
    const naming = await call(devTokens.access_token, tool('get_docs', {}), {
      'x-organization-slug': betaSlug,
    });
    const named = await call(devTokens.access_token, tool('get_docs', {}), {
      'x-organization-slug': acmeSlug.toUpperCase(),
    });
    const mismatch = z
      .looseObject({
        code: z.literal('ORG_MISMATCH'),
        data: z.looseObject({ organization: z.string() }),
      })
      .safeParse(naming.body);
    record(
      'agent door: a connection works in the organization it was made for — naming another answers ORG_MISMATCH with the one it is for, naming its own in any case works (AGCONN-R12)',
      naming.status === 403 &&
        mismatch.success &&
        mismatch.data.data.organization === acmeSlug &&
        naming.challenge === null &&
        named.status === 200,
      `other=${naming.status} ${JSON.stringify(naming.body)?.slice(0, 200)}, own=${named.status}`,
    );

    // The role is the person's now.
    await setRole(dev.userId, 'member');
    const demoted = result(
      (
        await call(
          devTokens.access_token,
          tool('save_automation', {
            automation: { ...DOC_EXAMPLE.automation, name: automation },
            message: 'refused by the role',
          }),
        )
      ).body,
    );
    await setRole(dev.userId, 'disabled');
    const switchedOff = await call(
      devTokens.access_token,
      tool('get_docs', {}),
    );
    await setRole(dev.userId, 'developer');
    const restored = await call(devTokens.access_token, tool('get_docs', {}));
    record(
      'agent door: the call acts with its person’s role now — a demoted person is refused what the connection’s access would allow, a switched-off seat opens nothing, and the access is back with the seat (AGCONN-R11, MCP-R40)',
      demoted?.isError === true &&
        demoted.code === 'FORBIDDEN_DEVELOPER_SETTINGS' &&
        switchedOff.status === 401 &&
        (switchedOff.challenge ?? '').includes('error="invalid_token"') &&
        restored.status === 200,
      `demoted=${JSON.stringify(demoted)?.slice(0, 160)}, switched off=${switchedOff.status}, restored=${restored.status}`,
    );

    // A member's agent: the role is judged first, then what it can ask for.
    const holderTokens = await connect(holder.cookie, READ_SETTINGS);
    const memberSave = result(
      (
        await call(
          holderTokens.access_token,
          tool('save_automation', {
            automation: { ...DOC_EXAMPLE.automation, name: automation },
          }),
        )
      ).body,
    );
    const memberInvoke = result(
      (
        await call(
          holderTokens.access_token,
          tool('invoke_capability', { id: automation, input: {} }),
        )
      ).body,
    );
    const memberSettings = await call(
      holderTokens.access_token,
      tool('get_settings', {}),
    );
    const memberDeploy = await call(
      holderTokens.access_token,
      tool('get_docs', {}),
    );
    record(
      'agent door: a member’s agent is told the role refuses a save, that no connection of its role can hold the access to invoke a capability, and reads settings with the access it was allowed (MCP-R40)',
      memberSave?.isError === true &&
        memberSave.code === 'FORBIDDEN_DEVELOPER_SETTINGS' &&
        memberInvoke?.isError === true &&
        memberInvoke.code === 'INSUFFICIENT_SCOPE' &&
        (memberInvoke.hint ?? '').includes('cannot hold') &&
        memberSettings.status === 200 &&
        result(memberSettings.body)?.isError === false &&
        memberDeploy.status === 200,
      `save=${JSON.stringify(memberSave)?.slice(0, 120)}, invoke=${JSON.stringify(memberInvoke)?.slice(0, 160)}, settings=${memberSettings.status}`,
    );

    // The token opens the endpoint alone, and the endpoint tells a caller
    // with nothing where to sign in.
    const elsewhere = await fetch(`${base}/api/v1/automations`, {
      headers: { authorization: `Bearer ${devTokens.access_token}` },
    });
    const bare = await call(null, tool('get_docs', {}));
    const junk = await call('a.b.c', tool('get_docs', {}));
    const metadata = z
      .looseObject({
        resource: z.string(),
        authorization_servers: z.array(z.string()),
      })
      .parse(
        await (
          await fetch(`${base}/.well-known/oauth-protected-resource/api/v1/mcp`)
        ).json(),
      );
    record(
      'agent door: a token opens no route but the MCP endpoint, a caller with nothing is told where the endpoint’s metadata is — which the deployment serves — and a token no one issued is refused (AGCONN-R13, AGCONN-R14, AGCONN-R15)',
      elsewhere.status === 401 &&
        bare.status === 401 &&
        bare.challenge?.startsWith(
          `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/v1/mcp", scope="tale:mcp `,
        ) === true &&
        metadata.resource === mcp &&
        metadata.authorization_servers.join() === issuer &&
        junk.status === 401 &&
        (junk.challenge ?? '').startsWith('Bearer error="invalid_token"'),
      `route=${elsewhere.status}, bare=${bare.status} ${bare.challenge}, metadata=${JSON.stringify(metadata)}, junk=${junk.status} ${junk.challenge}`,
    );

    // Ending the connection ends the agent's access at once; a token from
    // before a reconnection is not the new connection's.
    const route = `${base}/api/app/agent-connections`;
    // Other live connections of the same person — another app in this
    // organization, and this app in the other organization they belong to —
    // must not stand in for the one that ended.
    const decoys = [randomUUID(), randomUUID()];
    const decoyAt = Date.now();
    await sql`
      INSERT INTO app.agent_connections (
        id, org_id, user_id, client_id, client_name, client_provenance,
        redirect_host, scopes, created_at_ms, updated_at_ms
      ) VALUES
        (${decoys[0] ?? ''}, ${acme}, ${dev.userId},
         'https://other-agent.example.test/client.json', 'Other agent',
         'registered', 'localhost', ${['tale:mcp']}::text[], ${decoyAt}, ${decoyAt}),
        (${decoys[1] ?? ''}, ${beta}, ${dev.userId}, ${DOCUMENT_URL},
         'Lane Agent', 'registered', 'localhost', ${['tale:mcp']}::text[],
         ${decoyAt}, ${decoyAt})
    `;
    const ended = await fetch(
      `${route}/${devConnection?.id ?? 'none'}?orgId=${acme}`,
      { method: 'DELETE', headers: { ...headers, cookie: dev.cookie } },
    );
    const afterEnd = await call(devTokens.access_token, tool('get_docs', {}));
    await sql`DELETE FROM app.agent_connections WHERE id = ANY(${decoys})`;
    const refreshed = await flow.token({
      grant_type: 'refresh_token',
      refresh_token: devTokens.refresh_token,
    });
    const reconnected = await connect(dev.cookie);
    const second = await connectionOf(dev.userId);
    const original = second?.createdAt ?? 0;
    const shiftTo = (at: number) =>
      sql`
        UPDATE app.agent_connections SET created_at_ms = ${at}
        WHERE id = ${second?.id ?? ''}
      `;
    await shiftTo(Date.now() + 120_000);
    const beforeConnection = await call(
      devTokens.access_token,
      tool('get_docs', {}),
    );
    await shiftTo(original);
    const sameConnection = await call(
      reconnected.access_token,
      tool('get_docs', {}),
    );
    record(
      'agent door: disconnecting ends the agent’s access at once whatever token it still holds, and a token minted before a connection was made is refused by it (AGCONN-R11)',
      ended.status === 200 &&
        afterEnd.status === 401 &&
        refreshed.status === 400 &&
        second !== undefined &&
        second.id !== devConnection?.id &&
        beforeConnection.status === 401 &&
        sameConnection.status === 200,
      `delete=${ended.status}, token after=${afterEnd.status}, refresh=${refreshed.status}, earlier token=${beforeConnection.status}, new token=${sameConnection.status}`,
    );

    // A seat that ends takes the agent with it.
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM "member"
        WHERE "organizationId" = ${acme} AND "userId" = ${dev.userId}
      `;
      await removeMembershipCascade(tx, acme, dev.userId);
    });
    const afterSeat = await call(
      reconnected.access_token,
      tool('get_docs', {}),
    );
    record(
      'agent door: a person who leaves the organization is refused at the endpoint with the token they still hold (AGCONN-R4, AGCONN-R11)',
      afterSeat.status === 401,
      `after the seat=${afterSeat.status}`,
    );
  } finally {
    await sql`DELETE FROM "oauthClient" WHERE "clientId" = ${DOCUMENT_URL}`;
    if (savedSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSiteUrl;
  }
}
