/**
 * Real Postgres and HTTP proof of a person connecting a coding agent to an
 * organization: the consent made for the organization they chose, who may
 * connect an agent there and with which access, the connection recorded
 * before the code is handed over, the tokens that name the organization, a
 * refresh that ends when the person's seat does, and a disconnect from the
 * app that ends the agent at once. The consent, code and token rows are
 * Better Auth's own, so this is where Tale's gate, its claims and its raw
 * writes of them meet the real schema and the real library.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { type RecordCheck, signUpUser } from '../integration-lane-helpers.ts';
import { AGENT_REDIRECT, DOCUMENT_URL } from './agent-oauth-integration.ts';
import { configuredMcpResources, seedMcpResources } from './agent-oauth.ts';
import { removeMembershipCascade } from './membership.ts';
import { OIDC_ORGANIZATION_CLAIM } from './oidc.ts';

const EDIT = 'tale:mcp tale:automations.write offline_access';
const READ = 'tale:mcp tale:settings.read offline_access';

export async function checkAgentConsent(
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
    const owner = await signUpUser(base, `consent-owner-${suffix}`);
    const dev = await signUpUser(base, `consent-dev-${suffix}`);
    const staleDev = await signUpUser(base, `consent-stale-${suffix}`);
    const member = await signUpUser(base, `consent-member-${suffix}`);
    const holder = await signUpUser(base, `consent-holder-${suffix}`);
    const stranger = await signUpUser(base, `consent-stranger-${suffix}`);
    const people = [owner, dev, staleDev, member, holder, stranger];
    await sql`
      UPDATE "user" SET "emailVerified" = true
      WHERE "id" = ANY(${people.map((person) => person.userId)})
    `;
    const orgId = z.object({ id: z.string() }).parse(
      await (
        await fetch(`${base}/api/auth/organization/create`, {
          method: 'POST',
          headers: { ...headers, cookie: owner.cookie },
          body: JSON.stringify({
            name: 'Agent consent lane',
            slug: `agent-consent-${suffix}`,
          }),
        })
      ).json(),
    ).id;
    const join = (userId: string, role: string) =>
      sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
        VALUES (gen_random_uuid(), ${orgId}, ${userId}, ${role}, ${new Date()})
      `;
    await join(dev.userId, 'developer');
    await join(staleDev.userId, 'developer');
    await join(member.userId, 'member');
    await join(holder.userId, 'member');
    // The holder may use a key-using door, so may connect an agent; a
    // member's access stays the member's.
    await sql`
      INSERT INTO app.competence_records (
        org_id, user_id, competence, granted_by, granted_at_ms
      ) VALUES (
        ${orgId}, ${holder.userId}, 'tale:models.api', ${owner.userId},
        ${Date.now()}
      )
    `;
    // A session older than a day.
    await sql`
      UPDATE "session" SET "createdAt" = ${new Date(Date.now() - 2 * 86_400_000)}
      WHERE "userId" = ${staleDev.userId}
    `;

    const locationOf = async (response: Response) => {
      const returned = z.object({ url: z.string() }).safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      return new URL(
        response.headers.get('location') ??
          (returned.success ? returned.data.url : '/'),
        base,
      );
    };
    /** An agent's authorization request, signed in as `cookie`. */
    const begin = async (cookie: string, scope: string) => {
      const verifier = randomBytes(32).toString('base64url');
      const response = await fetch(
        `${issuer}/oauth2/authorize?${new URLSearchParams({
          client_id: DOCUMENT_URL,
          redirect_uri: AGENT_REDIRECT,
          response_type: 'code',
          scope,
          state: 'lane',
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
          code_challenge_method: 'S256',
        }).toString()}`,
        {
          headers: {
            cookie,
            Accept: 'text/html',
            'Sec-Fetch-Mode': 'navigate',
          },
          redirect: 'manual',
        },
      );
      const next = await locationOf(response);
      return { verifier, oauthQuery: next.search.slice(1), page: next };
    };
    /** What the consent page does when the person allows. */
    const allow = async (
      cookie: string,
      body: { scope?: string; organizationId?: string | null } = {},
      asked = EDIT,
    ) => {
      const { verifier, oauthQuery, page } = await begin(cookie, asked);
      const response = await fetch(`${issuer}/oauth2/consent`, {
        method: 'POST',
        headers: { ...headers, cookie },
        body: JSON.stringify({
          accept: true,
          ...(body.scope === undefined
            ? { scope: asked }
            : { scope: body.scope }),
          oauth_query: oauthQuery,
          ...(body.organizationId === null
            ? {}
            : { tale: { organizationId: body.organizationId ?? orgId } }),
        }),
      });
      const answer = z
        .looseObject({
          url: z.string().optional(),
          code: z.string().optional(),
          data: z
            .looseObject({ scopes: z.array(z.string()).optional() })
            .optional(),
        })
        .parse(await response.json());
      const code =
        answer.url === undefined
          ? undefined
          : (new URL(answer.url, base).searchParams.get('code') ?? undefined);
      return {
        status: response.status,
        answer,
        code,
        verifier,
        page,
      };
    };
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    const tokenAnswer = async (fields: Record<string, string>) => {
      const response = await fetch(`${issuer}/oauth2/token`, {
        method: 'POST',
        headers: form,
        body: new URLSearchParams({ client_id: DOCUMENT_URL, ...fields }),
      });
      return { status: response.status, body: await response.json() };
    };
    const tokensOf = (body: unknown) =>
      z
        .object({ access_token: z.string(), refresh_token: z.string() })
        .parse(body);
    const keySet = createRemoteJWKSet(new URL(`${issuer}/jwks`));
    const verified = async (accessToken: string) =>
      (
        await jwtVerify(accessToken, keySet, {
          issuer,
          audience: mcp,
          algorithms: ['RS256'],
        })
      ).payload;
    const liveFor = (userId: string) =>
      sql<
        {
          id: string;
          clientName: string;
          provenance: string;
          clientHost: string | null;
          redirectHost: string;
          scopes: string[];
        }[]
      >`
        SELECT id, client_name AS "clientName",
               client_provenance AS provenance, client_host AS "clientHost",
               redirect_host AS "redirectHost", scopes
        FROM app.agent_connections
        WHERE org_id = ${orgId} AND user_id = ${userId}
          AND client_id = ${DOCUMENT_URL} AND revoked_at_ms IS NULL
      `;
    const consentsOf = async (userId: string) =>
      (
        await sql<{ referenceId: string | null }[]>`
          SELECT "referenceId" FROM "oauthConsent"
          WHERE "clientId" = ${DOCUMENT_URL} AND "userId" = ${userId}
        `
      ).map((row) => row.referenceId);
    const audit = (resourceId: string) =>
      sql<{ action: string; actorId: string; reason: string | null }[]>`
        SELECT action, actor_id AS "actorId", metadata->>'reason' AS reason
        FROM app.audit_logs
        WHERE org_id = ${orgId} AND resource_type = 'agent_connection'
          AND resource_id = ${resourceId}
        ORDER BY ts, id
      `;

    // A developer connects an agent to the organization they chose.
    const connected = await allow(dev.cookie);
    const devConnection = (await liveFor(dev.userId))[0];
    const devAudit =
      devConnection === undefined ? [] : await audit(devConnection.id);
    record(
      'agent consent: a developer connects an agent to the organization they chose — the consent is tied to it and a connection is recorded for the app, the person and the access, named in the audit log (AGCONN-R7, AGCONN-R10)',
      connected.status === 200 &&
        connected.code !== undefined &&
        (await consentsOf(dev.userId)).join() === orgId &&
        devConnection?.clientName === 'Lane Agent' &&
        devConnection.provenance === 'metadata_document' &&
        devConnection.clientHost === 'agent.example.test' &&
        devConnection.redirectHost === '127.0.0.1' &&
        devConnection.scopes.join() === 'tale:mcp,tale:automations.write' &&
        devAudit.map((row) => row.action).join() ===
          'agent_connection.created' &&
        devAudit[0]?.actorId === dev.userId,
      `status=${connected.status}, code=${connected.code !== undefined}, consents=${(await consentsOf(dev.userId)).join()}, connection=${JSON.stringify(devConnection)}, audit=${JSON.stringify(devAudit)}`,
    );

    // Its tokens name the organization, now and at every refresh.
    const exchanged = await tokenAnswer({
      grant_type: 'authorization_code',
      code: connected.code ?? '',
      redirect_uri: AGENT_REDIRECT,
      code_verifier: connected.verifier,
    });
    const first = tokensOf(exchanged.body);
    const claims = await verified(first.access_token);
    const refreshed = await tokenAnswer({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    });
    const second = tokensOf(refreshed.body);
    const refreshedClaims = await verified(second.access_token);
    const organizationOf = (payload: Record<string, unknown>) =>
      JSON.stringify(payload[OIDC_ORGANIZATION_CLAIM]);
    record(
      'agent consent: the code earns an access token for the MCP endpoint that names the organization, with the access allowed, and a refresh keeps naming it',
      exchanged.status === 200 &&
        claims.sub === dev.userId &&
        claims.aud === mcp &&
        claims.scope === EDIT &&
        organizationOf(claims).includes(orgId) &&
        organizationOf(claims).includes('"developer"') &&
        refreshed.status === 200 &&
        organizationOf(refreshedClaims).includes(orgId),
      `exchange=${exchanged.status}, claims=${JSON.stringify(claims).slice(0, 240)}, refresh=${refreshed.status}`,
    );

    // Who may connect, and with what.
    const beforeRefusals = {
      member: (await consentsOf(member.userId)).length,
      stranger: (await consentsOf(stranger.userId)).length,
    };
    const asMember = await allow(member.cookie, {}, READ);
    const asStranger = await allow(stranger.cookie, {}, READ);
    const noOrganization = await allow(dev.cookie, { organizationId: null });
    const holderBeyond = await allow(holder.cookie);
    const holderReads = await allow(holder.cookie, {}, READ);
    const withoutReading = await allow(dev.cookie, {
      scope: 'tale:automations.write offline_access',
    });
    const staleEdit = await allow(staleDev.cookie);
    const staleReads = await allow(staleDev.cookie, {}, READ);
    const refused = [
      asMember,
      asStranger,
      noOrganization,
      holderBeyond,
      withoutReading,
      staleEdit,
    ];
    const codesOf = refused.map(
      (entry) => `${entry.status}/${String(entry.answer.code)}`,
    );
    record(
      'agent consent: a member without the right, a stranger to the organization, a consent that names none, access beyond the role, access without reading, and an old session asking for more than reading are each refused with their code, and no consent is stored (AGCONN-R7, AGCONN-R8, AGCONN-R9)',
      refused.every((entry) => entry.code === undefined) &&
        codesOf.join() ===
          [
            '403/AGENT_CONNECT_FORBIDDEN',
            '403/ORG_FORBIDDEN',
            '400/AGENT_CONSENT_ORG_REQUIRED',
            '403/AGENT_SCOPE_NOT_ALLOWED',
            '400/AGENT_SCOPE_MCP_REQUIRED',
            '403/SESSION_NOT_FRESH',
          ].join() &&
        holderBeyond.answer.data?.scopes?.join() === 'tale:automations.write' &&
        (await consentsOf(member.userId)).length === beforeRefusals.member &&
        (await consentsOf(stranger.userId)).length === beforeRefusals.stranger,
      codesOf.join(),
    );
    record(
      'agent consent: a member who holds a key-using competence connects an agent with the access a member has, and an old session connects one that only reads (AGCONN-R7, AGCONN-R9)',
      holderReads.status === 200 &&
        holderReads.code !== undefined &&
        (await liveFor(holder.userId))[0]?.scopes.join() ===
          'tale:mcp,tale:settings.read' &&
        staleReads.status === 200 &&
        staleReads.code !== undefined,
      `holder=${holderReads.status}, stale reads=${staleReads.status}`,
    );

    // A person who left cannot refresh; an ended seat ends the agent.
    await sql`
      DELETE FROM "member"
      WHERE "organizationId" = ${orgId} AND "userId" = ${dev.userId}
    `;
    const orphan = await tokenAnswer({
      grant_type: 'refresh_token',
      refresh_token: second.refresh_token,
    });
    await join(dev.userId, 'developer');
    await sql.begin(async (tx) => {
      await tx`
        DELETE FROM "member"
        WHERE "organizationId" = ${orgId} AND "userId" = ${dev.userId}
      `;
      await removeMembershipCascade(tx, orgId, dev.userId);
    });
    const ended = await tokenAnswer({
      grant_type: 'refresh_token',
      refresh_token: second.refresh_token,
    });
    const endedRow = (
      await sql<{ reason: string | null; by: string | null }[]>`
        SELECT revoke_reason AS reason, revoked_by AS by
        FROM app.agent_connections WHERE id = ${devConnection?.id ?? ''}
      `
    )[0];
    record(
      'agent consent: a refresh by a person who left the organization is an invalid grant, and removing the seat ends the agent — its consent and tokens gone — so the refresh is refused (AGCONN-R4, AGCONN-R7)',
      orphan.status === 400 &&
        z.object({ error: z.literal('invalid_grant') }).safeParse(orphan.body)
          .success &&
        ended.status === 400 &&
        endedRow?.reason === 'membership_ended' &&
        endedRow.by === 'system' &&
        (await consentsOf(dev.userId)).length === 0,
      `orphan=${orphan.status} ${JSON.stringify(orphan.body)}, ended=${ended.status}, row=${JSON.stringify(endedRow)}`,
    );

    // Disconnecting from the app ends the agent at once.
    const mine = await allow(owner.cookie);
    const mineTokens = tokensOf(
      (
        await tokenAnswer({
          grant_type: 'authorization_code',
          code: mine.code ?? '',
          redirect_uri: AGENT_REDIRECT,
          code_verifier: mine.verifier,
        })
      ).body,
    );
    const route = `${base}/api/app/agent-connections`;
    const listed = z
      .object({
        connections: z.array(
          z.looseObject({ id: z.string(), userId: z.string() }),
        ),
        canSeeEveryone: z.boolean(),
      })
      .parse(
        await (
          await fetch(`${route}?orgId=${orgId}`, {
            headers: { cookie: owner.cookie },
          })
        ).json(),
      );
    const ownerConnection = listed.connections[0];
    const everyone = z
      .object({ connections: z.array(z.looseObject({ userId: z.string() })) })
      .parse(
        await (
          await fetch(`${route}?orgId=${orgId}&scope=everyone`, {
            headers: { cookie: owner.cookie },
          })
        ).json(),
      );
    const disconnected = await fetch(
      `${route}/${ownerConnection?.id ?? 'none'}?orgId=${orgId}`,
      { method: 'DELETE', headers: { ...headers, cookie: owner.cookie } },
    );
    const afterwards = await tokenAnswer({
      grant_type: 'refresh_token',
      refresh_token: mineTokens.refresh_token,
    });
    const ownerAudit =
      ownerConnection === undefined ? [] : await audit(ownerConnection.id);
    const memberSees = z.object({ connections: z.array(z.unknown()) }).parse(
      await (
        await fetch(`${route}?orgId=${orgId}&scope=everyone&ended=true`, {
          headers: { cookie: member.cookie },
        })
      ).json(),
    );
    record(
      "agent consent: the app lists a person's own agent, an owner can list everyone's, disconnecting ends the agent at once — its consent and tokens gone, the audit log saying who — and a member sees nothing of anyone else's (AGCONN-R1, AGCONN-R2, AGCONN-R3)",
      listed.connections.length === 1 &&
        ownerConnection?.userId === owner.userId &&
        listed.canSeeEveryone &&
        everyone.connections.some(
          (connection) => connection.userId === owner.userId,
        ) &&
        disconnected.status === 200 &&
        afterwards.status === 400 &&
        (await liveFor(owner.userId)).length === 0 &&
        (await consentsOf(owner.userId)).length === 0 &&
        ownerAudit.map((row) => row.action).join() ===
          'agent_connection.created,agent_connection.revoked' &&
        ownerAudit[1]?.actorId === owner.userId &&
        ownerAudit[1].reason === 'user' &&
        memberSees.connections.length === 0,
      `list=${listed.connections.length}, delete=${disconnected.status}, refresh=${afterwards.status}, audit=${JSON.stringify(ownerAudit)}, member sees=${memberSees.connections.length}`,
    );
  } finally {
    await sql`DELETE FROM "oauthClient" WHERE "clientId" = ${DOCUMENT_URL}`;
    if (savedSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSiteUrl;
  }
}
