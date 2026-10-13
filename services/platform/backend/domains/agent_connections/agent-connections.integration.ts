/**
 * Real Postgres and HTTP proof of the coding agents' connections: one live
 * connection for a person, organization and app (the partial unique index
 * and the lock hold under concurrent consents), the audit rows and hints
 * each change leaves, who sees and who may end a connection, and what ending
 * one takes from the sign-in server — the consent and every refresh token
 * of this organization's grant, never another organization's — whether a
 * person, an admin or a seat that ended did it. A teardown of the
 * organization removes what the sign-in server holds for it. The provider's
 * tables are Better Auth's own, so this is where Tale's raw writes of them
 * meet the real schema.
 */
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { removeMembershipCascade } from '../../auth/membership.ts';
import {
  type RecordCheck,
  signUpUser,
} from '../../integration-lane-helpers.ts';
import { deleteOrganization } from '../organizations/service.ts';
import {
  type AgentConnection,
  connectAgent,
  disconnectAgent,
  listAgentConnections,
} from './service.ts';

const SCOPES_READ = ['tale:mcp'];
const SCOPES_EDIT = ['tale:mcp', 'tale:automations.write'];

/** Thrown to roll a transaction back after its state was read. */
class RollBack extends Error {}

export async function checkAgentConnections(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const headers = { 'content-type': 'application/json', origin: base };
  const owner = await signUpUser(base, `agent-conn-owner-${suffix}`);
  const ada = await signUpUser(base, `agent-conn-ada-${suffix}`);
  const mia = await signUpUser(base, `agent-conn-mia-${suffix}`);
  const createOrg = async (cookie: string, slug: string): Promise<string> =>
    z.object({ id: z.string() }).parse(
      await (
        await fetch(`${base}/api/auth/organization/create`, {
          method: 'POST',
          headers: { ...headers, cookie },
          body: JSON.stringify({ name: `Agent connections ${slug}`, slug }),
        })
      ).json(),
    ).id;
  const acme = await createOrg(owner.cookie, `agent-conn-acme-${suffix}`);
  const beta = await createOrg(ada.cookie, `agent-conn-beta-${suffix}`);
  const join = (orgId: string, userId: string, role: string) =>
    sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (gen_random_uuid(), ${orgId}, ${userId}, ${role}, ${new Date()})
    `;
  await join(acme, ada.userId, 'developer');
  await join(acme, mia.userId, 'member');

  const claude = `https://claude.example.test/${suffix}/client.json`;
  const cursor = `https://cursor.example.test/${suffix}/client.json`;
  const createdClients = [claude, cursor];
  for (const clientId of createdClients) {
    await sql`
      INSERT INTO "oauthClient" (
        "id", "clientId", "redirectUris", "scopes", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${clientId}, ${sql.json(['http://127.0.0.1:1/cb'])},
        ${sql.json(SCOPES_EDIT)}, ${new Date()}, ${new Date()}
      )
    `;
  }
  const adaActor = {
    actorId: ada.userId,
    actorType: 'user' as const,
    actorRole: 'developer',
  };
  const connect = (
    orgId: string,
    userId: string,
    clientId: string,
    scopes: string[],
    actor = adaActor,
  ) =>
    connectAgent(sql, {
      organizationId: orgId,
      userId,
      clientId,
      clientName: 'Claude Code',
      provenance: 'metadata_document',
      clientHost: 'claude.example.test',
      redirectHost: 'localhost',
      scopes,
      actor,
    });
  const live = (orgId: string) =>
    sql<{ id: string; userId: string; clientId: string; scopes: string[] }[]>`
      SELECT id, user_id AS "userId", client_id AS "clientId", scopes
      FROM app.agent_connections
      WHERE org_id = ${orgId} AND revoked_at_ms IS NULL
      ORDER BY created_at_ms, id
    `;
  const auditOf = (orgId: string) =>
    sql<
      {
        action: string;
        actorId: string;
        actorType: string;
        resourceId: string | null;
        reason: string | null;
        previous: unknown;
        next: unknown;
      }[]
    >`
      SELECT action, actor_id AS "actorId", actor_type AS "actorType",
             resource_id AS "resourceId", metadata->>'reason' AS reason,
             previous_state AS previous, new_state AS next
      FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'agent_connection'
      ORDER BY ts, id
    `;
  const hintsOf = (orgId: string) =>
    sql<{ entityId: string | null }[]>`
      SELECT entity_id AS "entityId" FROM app_realtime.outbox
      WHERE org_id = ${orgId} AND entity = 'agent_connection'
    `;
  /** What the sign-in server holds for a person's grant of an app to an
   * organization. */
  const grantOf = async (orgId: string, userId: string, clientId: string) => {
    const count = async (table: string) =>
      (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM ${sql(table)}
          WHERE "clientId" = ${clientId} AND "userId" = ${userId}
            AND "referenceId" = ${orgId}
        `
      )[0]?.n ?? -1;
    return {
      consent: await count('oauthConsent'),
      refresh: await count('oauthRefreshToken'),
      access: await count('oauthAccessToken'),
    };
  };
  /** The sign-in server's side of a grant: a consent, a refresh token in use,
   * one rotated away, and the access token the live one made. */
  const plantGrant = async (
    orgId: string,
    userId: string,
    clientId: string,
  ) => {
    await sql`
      INSERT INTO "oauthConsent" (
        "id", "clientId", "userId", "referenceId", "scopes", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${clientId}, ${userId}, ${orgId},
        ${sql.json(SCOPES_EDIT)}, ${new Date()}, ${new Date()}
      )
    `;
    const refreshIds: string[] = [];
    for (const rotated of [false, true]) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO "oauthRefreshToken" (
          "id", "token", "clientId", "userId", "referenceId", "expiresAt",
          "createdAt", "scopes", "revoked", "rotatedAt"
        ) VALUES (
          gen_random_uuid(), ${randomUUID()}, ${clientId}, ${userId}, ${orgId},
          ${new Date(Date.now() + 86_400_000)}, ${new Date()},
          ${sql.json(SCOPES_EDIT)},
          ${rotated ? new Date() : null}, ${rotated ? new Date() : null}
        )
        RETURNING "id"
      `;
      if (row !== undefined) refreshIds.push(row.id);
    }
    await sql`
      INSERT INTO "oauthAccessToken" (
        "id", "token", "clientId", "userId", "referenceId", "refreshId",
        "expiresAt", "createdAt", "scopes"
      ) VALUES (
        gen_random_uuid(), ${randomUUID()}, ${clientId}, ${userId}, ${orgId},
        ${refreshIds[0] ?? null}, ${new Date(Date.now() + 300_000)},
        ${new Date()}, ${sql.json(SCOPES_EDIT)}
      )
    `;
  };
  const viewer = (userId: string, role: string) => ({
    organizationId: acme,
    viewerId: userId,
    viewerRole: role,
  });

  try {
    // One connection per person, organization and app; allowing again
    // changes the access; two consents at once leave one.
    const first = await connect(acme, ada.userId, claude, SCOPES_READ);
    const edited = await connect(acme, ada.userId, claude, SCOPES_EDIT);
    const raced = await Promise.all(
      Array.from({ length: 8 }, () =>
        connect(acme, mia.userId, cursor, SCOPES_READ, {
          ...adaActor,
          actorId: mia.userId,
        }),
      ),
    );
    const duplicate = await sql`
      INSERT INTO app.agent_connections (
        id, org_id, user_id, client_id, client_name, client_provenance,
        redirect_host, scopes, created_at_ms, updated_at_ms
      ) VALUES (
        ${randomUUID()}, ${acme}, ${ada.userId}, ${claude}, 'Claude Code',
        'registered', 'localhost', ${SCOPES_READ}::text[], 1, 1
      )
    `.then(
      () => 'accepted',
      (error: unknown) => Reflect.get(Object(error), 'code'),
    );
    const afterConnect = await live(acme);
    const miaLive = afterConnect.filter((row) => row.userId === mia.userId);
    record(
      'agent connections: an app is connected once for a person and an organization, allowing again changes its access, and eight consents at once leave one (AGCONN-R6)',
      first.created &&
        !edited.created &&
        edited.scopesChanged &&
        edited.connection.id === first.connection.id &&
        edited.connection.scopes.join() === SCOPES_EDIT.join() &&
        raced.filter((entry) => entry.created).length === 1 &&
        new Set(raced.map((entry) => entry.connection.id)).size === 1 &&
        miaLive.length === 1 &&
        afterConnect.length === 2 &&
        duplicate === '23505',
      `first=${first.created}, again=${edited.created}/${edited.scopesChanged}, raced created=${raced.filter((entry) => entry.created).length}, live=${afterConnect.length}, duplicate insert=${String(duplicate)}`,
    );
    const audit = await auditOf(acme);
    const adaRows = audit.filter(
      (row) => row.resourceId === first.connection.id,
    );
    const hints = await hintsOf(acme);
    record(
      'agent connections: connecting and changing the access write an audit row each, naming the person and the access before and after, and hint the organization (AGCONN-R5)',
      adaRows.map((row) => row.action).join() ===
        'agent_connection.created,agent_connection.updated' &&
        adaRows.every(
          (row) => row.actorId === ada.userId && row.actorType === 'user',
        ) &&
        JSON.stringify(adaRows[1]?.previous) ===
          JSON.stringify({ scopes: SCOPES_READ }) &&
        JSON.stringify(adaRows[1]?.next) ===
          JSON.stringify({ scopes: SCOPES_EDIT }) &&
        // Allowing the same access again leaves no row.
        audit.filter((row) => row.resourceId === miaLive[0]?.id).length === 1 &&
        hints.some((hint) => hint.entityId === first.connection.id),
      JSON.stringify(adaRows.map((row) => row.action)),
    );

    // Who sees what.
    const asAda = await listAgentConnections(
      sql,
      viewer(ada.userId, 'developer'),
    );
    const adaAsksAll = await listAgentConnections(sql, {
      ...viewer(ada.userId, 'developer'),
      everyone: true,
      includeEnded: true,
    });
    const asOwner = await listAgentConnections(sql, {
      ...viewer(owner.userId, 'owner'),
      everyone: true,
    });
    const ownerOwn = await listAgentConnections(
      sql,
      viewer(owner.userId, 'owner'),
    );
    const asMia = await listAgentConnections(sql, viewer(mia.userId, 'member'));
    const sinceFuture = await listAgentConnections(sql, {
      ...viewer(owner.userId, 'owner'),
      everyone: true,
      since: Date.now() + 60_000,
    });
    const sincePast = await listAgentConnections(sql, {
      ...viewer(owner.userId, 'owner'),
      everyone: true,
      since: edited.connection.createdAt - 1,
    });
    const ids = (answer: { connections: AgentConnection[] }) =>
      answer.connections
        .map((connection) => connection.userId)
        .sort()
        .join();
    // When each agent last called is the endpoint's own count of calls made
    // with that connection: not an API key of the same id, not another
    // connection's calls, and nothing before the first.
    const activity = (
      credentialKind: string,
      credentialId: string,
      userId: string,
      lastAt: number,
    ) => sql`
      INSERT INTO app.mcp_client_activity (
        org_id, user_id, credential_kind, credential_id, method, tool, day,
        calls, last_at_ms
      ) VALUES (
        ${acme}, ${userId}, ${credentialKind}, ${credentialId}, 'tools/call',
        ${`probe-${lastAt}`}, 20261012, 1, ${lastAt}
      )
    `;
    const usedAt = Date.now() - 90_000;
    await activity('oauth', first.connection.id, ada.userId, usedAt - 60_000);
    await activity('oauth', first.connection.id, ada.userId, usedAt);
    await activity('api-key', first.connection.id, ada.userId, usedAt + 30_000);
    await activity('oauth', first.connection.id, mia.userId, usedAt + 45_000);
    const lastUsed = (
      await listAgentConnections(sql, {
        ...viewer(owner.userId, 'owner'),
        everyone: true,
      })
    ).connections.map((connection) => [
      connection.userId,
      connection.lastUsedAt,
    ]);
    const adaLastUsed = lastUsed.find(([userId]) => userId === ada.userId)?.[1];
    const miaLastUsed = lastUsed.find(([userId]) => userId === mia.userId)?.[1];
    record(
      "agent connections: a person sees their own, and only an owner or admin can ask for everyone's (AGCONN-R1)",
      ids(asAda) === ada.userId &&
        !asAda.canSeeEveryone &&
        ids(adaAsksAll) === ada.userId &&
        ids(asOwner) === [ada.userId, mia.userId].sort().join() &&
        asOwner.canSeeEveryone &&
        ids(ownerOwn) === '' &&
        ids(asMia) === mia.userId &&
        sinceFuture.connections.length === 0 &&
        sincePast.connections.length === 2 &&
        adaLastUsed === usedAt &&
        miaLastUsed === null,
      `ada=${ids(asAda)}, ada asks all=${ids(adaAsksAll)}, owner=${ids(asOwner)}, owner own=${ids(ownerOwn)}, mia=${ids(asMia)}, since future=${sinceFuture.connections.length}, since past=${sincePast.connections.length}, last used ada=${String(adaLastUsed)}/${usedAt} mia=${String(miaLastUsed)}/null`,
    );

    // Ending one: not another person's, and only this organization's grant.
    await plantGrant(acme, ada.userId, claude);
    await plantGrant(beta, ada.userId, claude);
    await join(beta, mia.userId, 'member');
    const betaConnection = await connect(beta, ada.userId, claude, SCOPES_READ);
    const beforeEnd = {
      acme: await grantOf(acme, ada.userId, claude),
      beta: await grantOf(beta, ada.userId, claude),
    };
    const refused = await disconnectAgent(sql, {
      organizationId: acme,
      connectionId: first.connection.id,
      viewer: { userId: mia.userId, role: 'member' },
    }).then(
      () => 'ended',
      (error: unknown) => Reflect.get(Object(error), 'code'),
    );
    const elsewhere = await disconnectAgent(sql, {
      organizationId: beta,
      connectionId: first.connection.id,
      viewer: { userId: ada.userId, role: 'developer' },
    }).then(
      () => 'ended',
      (error: unknown) => Reflect.get(Object(error), 'code'),
    );
    const stillLive = (await live(acme)).some(
      (row) => row.id === first.connection.id,
    );
    await disconnectAgent(sql, {
      organizationId: acme,
      connectionId: first.connection.id,
      viewer: { userId: ada.userId, role: 'developer', email: ada.email },
    });
    const again = await disconnectAgent(sql, {
      organizationId: acme,
      connectionId: first.connection.id,
      viewer: { userId: ada.userId, role: 'developer' },
    }).then(
      () => 'ended',
      (error: unknown) => Reflect.get(Object(error), 'code'),
    );
    const ended = (
      await sql<
        { revokedBy: string | null; reason: string | null; at: number | null }[]
      >`
        SELECT revoked_by AS "revokedBy", revoke_reason AS reason,
               revoked_at_ms::float8 AS at
        FROM app.agent_connections WHERE id = ${first.connection.id}
      `
    )[0];
    const afterEnd = {
      acme: await grantOf(acme, ada.userId, claude),
      beta: await grantOf(beta, ada.userId, claude),
    };
    const endedAudit = (await auditOf(acme)).filter(
      (row) =>
        row.resourceId === first.connection.id &&
        row.action === 'agent_connection.revoked',
    );
    record(
      "agent connections: another person's connection, one of another organization and one already ended are not found; the person's own ends, and takes this organization's consent and tokens and nothing of another's (AGCONN-R2, AGCONN-R3)",
      refused === 'AGENT_CONNECTION_NOT_FOUND' &&
        elsewhere === 'AGENT_CONNECTION_NOT_FOUND' &&
        again === 'AGENT_CONNECTION_NOT_FOUND' &&
        stillLive &&
        ended?.revokedBy === ada.userId &&
        ended.reason === 'user' &&
        typeof ended.at === 'number' &&
        JSON.stringify(beforeEnd.acme) ===
          JSON.stringify({ consent: 1, refresh: 2, access: 1 }) &&
        JSON.stringify(afterEnd.acme) ===
          JSON.stringify({ consent: 0, refresh: 0, access: 0 }) &&
        JSON.stringify(afterEnd.beta) === JSON.stringify(beforeEnd.beta) &&
        (await live(beta)).some(
          (row) => row.id === betaConnection.connection.id,
        ) &&
        endedAudit.length === 1 &&
        endedAudit[0]?.actorId === ada.userId &&
        endedAudit[0].reason === 'user',
      `refused=${String(refused)}, elsewhere=${String(elsewhere)}, again=${String(again)}, ended=${JSON.stringify(ended)}, acme ${JSON.stringify(beforeEnd.acme)}→${JSON.stringify(afterEnd.acme)}, beta ${JSON.stringify(afterEnd.beta)}`,
    );

    // The person's own disconnect tells them nothing; the notices an agent's
    // ending leaves in a person's bell are read from here on.
    const noticesOf = (userId: string) =>
      sql<
        {
          bodyKey: string;
          params: { client?: string; name?: string } | null;
          actorType: string;
          actorId: string | null;
          org: string;
        }[]
      >`
        SELECT body_key AS "bodyKey", params, actor_type AS "actorType",
               actor_id AS "actorId", org_id AS org
        FROM app.user_notifications
        WHERE user_id = ${userId} AND type = 'agent_connection_ended'
        ORDER BY seq
      `;
    const noticesAfterOwnEnd = await noticesOf(ada.userId);

    // The same app allowed again is a new connection; an owner ends it as
    // an admin's act.
    await plantGrant(acme, ada.userId, claude);
    const reconnected = await connect(acme, ada.userId, claude, SCOPES_READ);
    await disconnectAgent(sql, {
      organizationId: acme,
      connectionId: reconnected.connection.id,
      viewer: { userId: owner.userId, role: 'owner' },
    });
    const adminEnd = (
      await sql<{ revokedBy: string | null; reason: string | null }[]>`
        SELECT revoked_by AS "revokedBy", revoke_reason AS reason
        FROM app.agent_connections WHERE id = ${reconnected.connection.id}
      `
    )[0];
    const history = await listAgentConnections(sql, {
      ...viewer(owner.userId, 'owner'),
      everyone: true,
      includeEnded: true,
    });
    const adminNotices = await noticesOf(ada.userId);
    const ownerName = (
      await sql<{ name: string }[]>`
        SELECT name FROM "user" WHERE id = ${owner.userId}
      `
    )[0]?.name;
    record(
      'agent connections: the person is told in their bell when an owner disconnects an agent of theirs, by name, and is told nothing of their own disconnect (AGCONN-R20)',
      noticesAfterOwnEnd.length === 0 &&
        adminNotices.length === 1 &&
        adminNotices[0]?.bodyKey === 'agentConnectionEndedAdminBody' &&
        adminNotices[0].org === acme &&
        adminNotices[0].actorType === 'user' &&
        adminNotices[0].actorId === owner.userId &&
        ownerName !== undefined &&
        adminNotices[0].params?.name === ownerName &&
        adminNotices[0].params.client === reconnected.connection.clientName,
      `own end: ${noticesAfterOwnEnd.length} notices, admin end: ${JSON.stringify(adminNotices)}`,
    );
    record(
      'agent connections: allowing a disconnected app again makes a new connection, an owner can end it as an admin, and the ended ones stay in the history an admin reads (AGCONN-R6, AGCONN-R2)',
      reconnected.created &&
        reconnected.connection.id !== first.connection.id &&
        adminEnd?.revokedBy === owner.userId &&
        adminEnd.reason === 'admin' &&
        history.connections.filter(
          (connection) => connection.revokedAt !== null,
        ).length === 2 &&
        (await grantOf(acme, ada.userId, claude)).consent === 0,
      JSON.stringify(adminEnd),
    );

    // A seat that ends takes the agents with it, in that organization only.
    await plantGrant(acme, ada.userId, claude);
    const seatConnection = await connect(acme, ada.userId, claude, SCOPES_EDIT);
    const cascade: {
      rows: { id: string; revokedBy: string | null; reason: string | null }[];
      refresh: number | undefined;
      beta: number | undefined;
      notices: number | undefined;
    } = { rows: [], refresh: undefined, beta: undefined, notices: undefined };
    await sql
      .begin(async (tx) => {
        await removeMembershipCascade(tx, acme, ada.userId);
        cascade.rows = await tx<
          { id: string; revokedBy: string | null; reason: string | null }[]
        >`
          SELECT id, revoked_by AS "revokedBy", revoke_reason AS reason
          FROM app.agent_connections
          WHERE org_id = ${acme} AND user_id = ${ada.userId}
            AND revoked_at_ms IS NOT NULL
            AND revoke_reason = 'membership_ended'
        `;
        cascade.refresh = (
          await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM "oauthRefreshToken"
            WHERE "userId" = ${ada.userId} AND "referenceId" = ${acme}
          `
        )[0]?.n;
        cascade.beta = (
          await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM app.agent_connections
            WHERE org_id = ${beta} AND user_id = ${ada.userId}
              AND revoked_at_ms IS NULL
          `
        )[0]?.n;
        // A seat that ended tells the person nothing: they can no longer
        // read that organization's bell.
        cascade.notices = (
          await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM app.user_notifications
            WHERE user_id = ${ada.userId} AND type = 'agent_connection_ended'
          `
        )[0]?.n;
        // Everything the cascade did is read; none of it is kept.
        throw new RollBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollBack)) throw error;
      });
    record(
      'agent connections: removing a member from an organization ends the agents they connected there — for the platform, with the consent and tokens — and leaves their agents in other organizations (AGCONN-R4)',
      cascade.rows.length === 1 &&
        cascade.rows[0]?.id === seatConnection.connection.id &&
        cascade.rows[0].revokedBy === 'system' &&
        cascade.refresh === 0 &&
        cascade.beta === 1 &&
        cascade.notices === adminNotices.length,
      JSON.stringify({
        rows: cascade.rows,
        refresh: cascade.refresh,
        beta: cascade.beta,
        notices: cascade.notices,
      }),
    );

    // An organization's teardown removes what the sign-in server holds for it.
    const doomed = await createOrg(owner.cookie, `agent-conn-doomed-${suffix}`);
    await join(doomed, mia.userId, 'member');
    await plantGrant(doomed, mia.userId, cursor);
    await plantGrant(acme, mia.userId, cursor);
    await connect(doomed, mia.userId, cursor, SCOPES_READ);
    const doomedName = (
      await sql<{ name: string }[]>`
        SELECT name FROM "organization" WHERE id = ${doomed}
      `
    )[0]?.name;
    await transactSerializable(sql, (tx) =>
      deleteOrganization(
        tx,
        { userId: owner.userId },
        doomed,
        doomedName ?? '',
      ),
    );
    const left = {
      doomed: await grantOf(doomed, mia.userId, cursor),
      acme: await grantOf(acme, mia.userId, cursor),
      rows: (
        await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM app.agent_connections
          WHERE org_id = ${doomed}
        `
      )[0]?.n,
    };
    record(
      "agent connections: deleting an organization removes its agent connections and the consent and tokens the sign-in server holds for it, and no other organization's",
      JSON.stringify(left.doomed) ===
        JSON.stringify({ consent: 0, refresh: 0, access: 0 }) &&
        left.acme.consent === 1 &&
        left.acme.refresh === 2 &&
        left.rows === 0,
      JSON.stringify(left),
    );
  } finally {
    await sql`DELETE FROM "oauthClient" WHERE "clientId" = ANY(${createdClients})`;
    await sql`
      DELETE FROM app.agent_connections WHERE org_id = ANY(${[acme, beta]})
    `;
  }
}
