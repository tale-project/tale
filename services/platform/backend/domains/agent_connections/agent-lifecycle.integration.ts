/**
 * Real Postgres and HTTP proof that a coding agent's connection ends when
 * what it was signed in by is no longer sound: a refresh token used twice
 * (the provider ends the app's sign-in everywhere and Tale ends every
 * connection with it — a retry the provider still answers ends nothing), a
 * password changed by the person or taken by an admin, a second factor an
 * admin reset, an erasure of the person, and the daily clean-up of what
 * agents leave behind. The tokens, consents and apps are the provider's own
 * tables, so this is where Tale's statements meet them.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { agentFlow } from '../../auth/agent-flow-integration.ts';
import { DOCUMENT_URL } from '../../auth/agent-oauth-integration.ts';
import {
  configuredMcpResources,
  seedMcpResources,
} from '../../auth/agent-oauth.ts';
import { storedRefreshToken } from '../../auth/agent-reuse.ts';
import {
  cookieHeaderFrom,
  ITEST_PASSWORD,
  type RecordCheck,
  signUpUser,
} from '../../integration-lane-helpers.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import { processErasure } from '../erasure/service.ts';
import { resetTwoFactorForMember } from '../members/service.ts';
import { disconnectAgent } from './service.ts';

const EDIT = 'tale:mcp tale:automations.write offline_access';
const NEW_PASSWORD = 'Itest-Passw0rd!2';
const DAY = 86_400_000;

export async function checkAgentLifecycle(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const headers = { 'content-type': 'application/json', origin: base };
  const savedSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = base;
  const seededApps: string[] = [];
  try {
    await seedMcpResources(sql, configuredMcpResources());
    const owner = await signUpUser(base, `life-owner-${suffix}`);
    const ada = await signUpUser(base, `life-ada-${suffix}`);
    const mia = await signUpUser(base, `life-mia-${suffix}`);
    const noah = await signUpUser(base, `life-noah-${suffix}`);
    const eve = await signUpUser(base, `life-eve-${suffix}`);
    const people = [owner, ada, mia, noah, eve];
    await sql`
      UPDATE "user" SET "emailVerified" = true
      WHERE "id" = ANY(${people.map((person) => person.userId)})
    `;
    const createOrg = async (cookie: string, slug: string) =>
      z.object({ id: z.string() }).parse(
        await (
          await fetch(`${base}/api/auth/organization/create`, {
            method: 'POST',
            headers: { ...headers, cookie },
            body: JSON.stringify({ name: `Agent lifecycle ${slug}`, slug }),
          })
        ).json(),
      ).id;
    const acme = await createOrg(owner.cookie, `agent-life-acme-${suffix}`);
    const beta = await createOrg(ada.cookie, `agent-life-beta-${suffix}`);
    const join = (orgId: string, userId: string, role: string) =>
      sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
        VALUES (gen_random_uuid(), ${orgId}, ${userId}, ${role}, ${new Date()})
      `;
    await join(acme, ada.userId, 'developer');
    await join(acme, mia.userId, 'developer');
    await join(acme, noah.userId, 'developer');
    await join(acme, eve.userId, 'developer');
    await join(beta, eve.userId, 'developer');
    const memberOf = async (orgId: string, userId: string) =>
      (
        await sql<{ id: string }[]>`
          SELECT "id" FROM "member"
          WHERE "organizationId" = ${orgId} AND "userId" = ${userId}
        `
      )[0]?.id ?? '';

    const inAcme = agentFlow({
      base,
      organizationId: acme,
      defaultScope: EDIT,
    });
    const inBeta = agentFlow({
      base,
      organizationId: beta,
      defaultScope: EDIT,
    });
    /** One person's connections of the lane's app: where, whether live, and
     * how each ended. */
    const connectionsOf = (userId: string) =>
      sql<
        {
          id: string;
          orgId: string;
          live: boolean;
          reason: string | null;
          by: string | null;
        }[]
      >`
        SELECT id, org_id AS "orgId", revoked_at_ms IS NULL AS live,
               revoke_reason AS reason, revoked_by AS by
        FROM app.agent_connections
        WHERE user_id = ${userId} AND client_id = ${DOCUMENT_URL}
        ORDER BY created_at_ms, id
      `;
    const liveCount = async (userId: string) =>
      (await connectionsOf(userId)).filter((row) => row.live).length;
    const grantRows = async (userId: string) =>
      (
        await sql<{ refresh: number; consent: number }[]>`
          SELECT
            (SELECT count(*)::int FROM "oauthRefreshToken"
              WHERE "clientId" = ${DOCUMENT_URL} AND "userId" = ${userId}) AS refresh,
            (SELECT count(*)::int FROM "oauthConsent"
              WHERE "clientId" = ${DOCUMENT_URL} AND "userId" = ${userId}) AS consent
        `
      )[0] ?? { refresh: -1, consent: -1 };
    const endingAudit = (orgId: string) =>
      sql<
        { actor: string; reason: string | null; resourceId: string | null }[]
      >`
        SELECT actor_id AS actor, metadata->>'reason' AS reason,
               resource_id AS "resourceId"
        FROM app.audit_logs
        WHERE org_id = ${orgId} AND action = 'agent_connection.revoked'
        ORDER BY ts, id
      `;
    /** A person connecting the app to an organization and the app taking
     * the code. */
    const connect = async (
      flow: typeof inAcme,
      cookie: string,
    ): Promise<{ access_token: string; refresh_token: string }> =>
      flow.tokensOf((await flow.exchange(await flow.allow(cookie))).body);

    // A refresh token used twice ends the app's sign-in everywhere.
    const adaAcme = await connect(inAcme, ada.cookie);
    await connect(inBeta, ada.cookie);
    await connect(inAcme, mia.cookie);
    const refresh = (flow: typeof inAcme, token: string) =>
      flow.token({ grant_type: 'refresh_token', refresh_token: token });
    const rotated = await refresh(inAcme, adaAcme.refresh_token);
    const retried = await refresh(inAcme, adaAcme.refresh_token);
    const afterRetry = await liveCount(ada.userId);
    const windowed = await sql`
      UPDATE "oauthRefreshToken"
      SET "rotationReplayExpiresAt" = ${new Date(Date.now() - 60_000)}
      WHERE "token" = ${storedRefreshToken(adaAcme.refresh_token)}
    `;
    const reused = await refresh(inAcme, adaAcme.refresh_token);
    const adaEnded = await connectionsOf(ada.userId);
    const adaGrant = await grantRows(ada.userId);
    const miaGrant = await grantRows(mia.userId);
    const reuseAudit = [
      ...(await endingAudit(acme)),
      ...(await endingAudit(beta)),
    ].filter((row) => row.reason === 'refresh_reuse');
    const unknown = await refresh(inAcme, 'a-token-no-one-issued');
    record(
      'agent lifecycle: a refresh token used twice ends the app’s connections of that person in every organization, as the platform’s doing, with their consent and tokens — a retry the provider still answers ends nothing, and nobody else’s sign-in is touched (AGCONN-R16)',
      rotated.status === 200 &&
        retried.status === 200 &&
        afterRetry === 2 &&
        windowed.count === 1 &&
        reused.status === 400 &&
        z.object({ error: z.literal('invalid_grant') }).safeParse(reused.body)
          .success &&
        adaEnded.length === 2 &&
        adaEnded.every(
          (row) =>
            !row.live && row.reason === 'refresh_reuse' && row.by === 'system',
        ) &&
        new Set(adaEnded.map((row) => row.orgId)).size === 2 &&
        adaGrant.refresh === 0 &&
        adaGrant.consent === 0 &&
        (await liveCount(mia.userId)) === 1 &&
        miaGrant.consent === 1 &&
        miaGrant.refresh > 0 &&
        reuseAudit.length === 2 &&
        reuseAudit.every((row) => row.actor === 'system') &&
        unknown.status === 400 &&
        (await liveCount(mia.userId)) === 1,
      `rotate=${rotated.status}, retry=${retried.status} live=${afterRetry}, window=${windowed.count}, reuse=${reused.status} ${JSON.stringify(reused.body)}, ada=${JSON.stringify(adaEnded)}, grant=${JSON.stringify(adaGrant)}/mia ${JSON.stringify(miaGrant)}, audit=${JSON.stringify(reuseAudit)}, unknown=${unknown.status}`,
    );

    // A password changed — by the person or by an admin — a second factor an
    // admin reset: the agents end with the sessions.
    await connect(inAcme, ada.cookie);
    await connect(inBeta, ada.cookie);
    const changed = await fetch(`${base}/api/app/users/update-password`, {
      method: 'POST',
      headers: { ...headers, cookie: mia.cookie },
      body: JSON.stringify({
        currentPassword: ITEST_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    });
    const miaEnded = await connectionsOf(mia.userId);
    const wrongPassword = await fetch(`${base}/api/app/users/update-password`, {
      method: 'POST',
      headers: { ...headers, cookie: ada.cookie },
      body: JSON.stringify({
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
      }),
    });
    record(
      'agent lifecycle: changing one’s own password ends the agents the person connected, for account security, and a change that was refused ends nothing (AGCONN-R17)',
      changed.status === 200 &&
        miaEnded.length === 1 &&
        miaEnded.every(
          (row) =>
            !row.live &&
            row.reason === 'account_security' &&
            row.by === 'system',
        ) &&
        wrongPassword.status >= 400 &&
        (await liveCount(ada.userId)) === 2,
      `change=${changed.status}, mia=${JSON.stringify(miaEnded)}, refused=${wrongPassword.status}, ada live=${await liveCount(ada.userId)}`,
    );

    // The person signs in again with the password they chose.
    const miaAgain = cookieHeaderFrom(
      await fetch(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: mia.email, password: NEW_PASSWORD }),
      }),
    );
    await connect(inAcme, miaAgain);
    const miaMember = await memberOf(acme, mia.userId);
    await sql.begin((tx) =>
      resetTwoFactorForMember(
        tx,
        { userId: owner.userId, email: owner.email },
        miaMember,
      ),
    );
    const afterReset = await connectionsOf(mia.userId);
    await connect(inAcme, noah.cookie);
    const noahMember = await memberOf(acme, noah.userId);
    const seized = await fetch(
      `${base}/api/app/users/members/${noahMember}/password`,
      {
        method: 'POST',
        headers: { ...headers, cookie: owner.cookie },
        body: JSON.stringify({ newPassword: NEW_PASSWORD }),
      },
    );
    const afterSeizure = await connectionsOf(noah.userId);
    const adminAudit = (await endingAudit(acme)).filter(
      (row) => row.actor === owner.userId,
    );
    record(
      'agent lifecycle: an admin taking a member’s password or resetting their second factor ends the member’s agents as the admin’s act, with the admin in the trail (AGCONN-R17)',
      seized.status === 200 &&
        afterSeizure.length === 1 &&
        !afterSeizure[0]?.live &&
        afterSeizure[0].reason === 'account_security' &&
        afterSeizure[0].by === owner.userId &&
        afterReset.length === 2 &&
        afterReset[0]?.by === 'system' &&
        !afterReset[1]?.live &&
        afterReset[1].reason === 'account_security' &&
        afterReset[1].by === owner.userId &&
        adminAudit.length === 2 &&
        (await liveCount(ada.userId)) === 2,
      `seize=${seized.status}, noah=${JSON.stringify(afterSeizure)}, mia=${JSON.stringify(afterReset)}, audit=${JSON.stringify(adminAudit)}`,
    );

    // The temporary password an admin set is replaced at the forced rotation,
    // which writes the credential itself rather than asking Better Auth to
    // change it: the agents the person connected meanwhile end with it.
    const noahChosen = 'Itest-Passw0rd!3';
    const noahTemporary = cookieHeaderFrom(
      await fetch(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: noah.email, password: NEW_PASSWORD }),
      }),
    );
    await connect(inAcme, noahTemporary);
    const liveBeforeRotation = await liveCount(noah.userId);
    const rotation = await fetch(`${base}/api/app/users/update-password`, {
      method: 'POST',
      headers: { ...headers, cookie: noahTemporary },
      body: JSON.stringify({ newPassword: noahChosen }),
    });
    const afterRotation = await connectionsOf(noah.userId);
    const chosenWorks = await fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: noah.email, password: noahChosen }),
    });
    record(
      'agent lifecycle: replacing a temporary or expired password at the forced rotation ends the agents the person connected meanwhile (AGCONN-R17)',
      liveBeforeRotation === 1 &&
        rotation.status === 200 &&
        chosenWorks.status === 200 &&
        afterRotation.length === 2 &&
        !afterRotation[1]?.live &&
        afterRotation[1].reason === 'account_security' &&
        afterRotation[1].by === 'system',
      `before=${liveBeforeRotation}, rotate=${rotation.status}, sign-in=${chosenWorks.status}, noah=${JSON.stringify(afterRotation)}`,
    );

    // An erasure deletes the person's connections in the organization — and
    // scrubs what the audit log says of them — and no other organization's.
    const eveAcme = await connect(inAcme, eve.cookie);
    const firstOfEve = (await connectionsOf(eve.userId))[0];
    if (firstOfEve !== undefined) {
      await disconnectAgent(sql, {
        organizationId: acme,
        connectionId: firstOfEve.id,
        viewer: { userId: eve.userId, role: 'developer' },
      });
    }
    await connect(inAcme, eve.cookie);
    await connect(inBeta, eve.cookie);
    const eveBefore = await connectionsOf(eve.userId);
    const eveAcmeIds = eveBefore
      .filter((row) => row.orgId === acme)
      .map((row) => row.id);
    const receipt = await sql<{ id: string }[]>`
      INSERT INTO app.gdpr_erasure_requests (
        org_id, target_user_id, reason, reason_code, requested_by,
        requested_at_ms, sla_deadline_at_ms, status, effective_at_ms,
        threads_targeted
      ) VALUES (
        ${acme}, ${eve.userId}, 'lane probe', 'objection', ${owner.userId},
        ${Date.now()}, ${Date.now() + 30 * DAY}, 'pending', ${Date.now()},
        ARRAY[]::text[]
      ) RETURNING id
    `;
    await processErasure(sql, receipt[0]?.id ?? '');
    const eveAfter = await connectionsOf(eve.userId);
    const eveAudit = await sql<
      {
        scrubbed: boolean | null;
        previous: unknown;
        metadata: unknown;
      }[]
    >`
      SELECT pii_scrubbed AS scrubbed, previous_state AS previous, metadata
      FROM app.audit_logs
      WHERE org_id = ${acme} AND resource_type = 'agent_connection'
        AND resource_id = ANY(${eveAcmeIds})
    `;
    const eveGrants = await sql<{ org: string | null }[]>`
      SELECT "referenceId" AS org FROM "oauthConsent"
      WHERE "clientId" = ${DOCUMENT_URL} AND "userId" = ${eve.userId}
    `;
    const counts = await sql<{ counts: Record<string, number> | null }[]>`
      SELECT counts FROM app.gdpr_erasure_requests WHERE id = ${receipt[0]?.id ?? ''}
    `;
    record(
      'agent lifecycle: erasing a person deletes their connections in that organization — live and ended, with their consent and tokens — keeps another organization’s, and leaves the audit rows scrubbed of who they were (AGCONN-R18)',
      eveAcme.access_token !== '' &&
        eveBefore.length === 3 &&
        eveAcmeIds.length === 2 &&
        eveAfter.length === 1 &&
        eveAfter[0]?.orgId === beta &&
        // Nobody else's connection in the organization is touched.
        (await liveCount(ada.userId)) === 2 &&
        eveAfter[0].live &&
        eveGrants.length === 1 &&
        eveGrants[0]?.org === beta &&
        eveAudit.length >= 3 &&
        eveAudit.every(
          (row) =>
            row.scrubbed === true &&
            row.previous === null &&
            row.metadata === null,
        ) &&
        counts[0]?.counts?.agentConnections === 2,
      `before=${eveBefore.length}, after=${JSON.stringify(eveAfter)}, consents=${JSON.stringify(eveGrants)}, audit=${JSON.stringify(eveAudit)}, counts=${JSON.stringify(counts[0]?.counts?.agentConnections)}`,
    );

    // The daily clean-up.
    const now = Date.now();
    const app = (label: string) => {
      const clientId = `https://gc-${label}-${suffix}.example.test/client.json`;
      seededApps.push(clientId);
      return clientId;
    };
    const makeApp = async (
      clientId: string,
      createdAt: number,
      options: {
        organizationId?: string;
        userId?: string;
        scopes?: string[];
      } = {},
    ) => {
      await sql`
        INSERT INTO "oauthClient" (
          "id", "clientId", "redirectUris", "scopes", "referenceId", "userId",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid(), ${clientId}, ${sql.json(['http://127.0.0.1:1/cb'])},
          ${sql.json(options.scopes ?? ['tale:mcp', 'tale:automations.write'])},
          ${options.organizationId ?? null}, ${options.userId ?? null},
          ${new Date(createdAt)}, ${new Date(createdAt)}
        )
      `;
    };
    const staleApp = app('stale');
    const freshApp = app('fresh');
    const liveApp = app('live');
    const workingApp = app('working');
    const ssoApp = app('sso');
    const ownedApp = app('owned');
    const plainApp = app('plain');
    await makeApp(staleApp, now - 3 * DAY);
    await makeApp(freshApp, now - 3_600_000);
    await makeApp(liveApp, now - 3 * DAY);
    await makeApp(workingApp, now - 3 * DAY);
    // An organization's own application and a person's own application are
    // never an agent's, whatever scopes they hold.
    await makeApp(ssoApp, now - 3 * DAY, {
      organizationId: acme,
      scopes: ['openid', 'tale:mcp'],
    });
    await makeApp(ownedApp, now - 3 * DAY, { userId: mia.userId });
    // An application that asks for no agent scope is nobody's agent.
    await makeApp(plainApp, now - 3 * DAY, { scopes: ['openid', 'profile'] });
    const token = (
      clientId: string,
      stamp: { revoked?: number; expires: number },
    ) => sql`
      INSERT INTO "oauthRefreshToken" (
        "id", "token", "clientId", "userId", "referenceId", "expiresAt",
        "createdAt", "scopes", "revoked"
      ) VALUES (
        gen_random_uuid(), ${randomUUID()}, ${clientId}, ${mia.userId}, ${acme},
        ${new Date(stamp.expires)}, ${new Date(now - 50 * DAY)},
        ${sql.json(['tale:mcp'])},
        ${stamp.revoked === undefined ? null : new Date(stamp.revoked)}
      )
    `;
    const consent = (clientId: string) => sql`
      INSERT INTO "oauthConsent" (
        "id", "clientId", "userId", "referenceId", "scopes", "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(), ${clientId}, ${mia.userId}, ${acme},
        ${sql.json(['tale:mcp'])}, ${new Date(now)}, ${new Date(now)}
      )
    `;
    // The app nobody connected goes with its consent and its retired token;
    // the app a person has connected stays, losing only a token retired
    // long ago; an app with a refresh token that still works stays.
    await consent(staleApp);
    await token(staleApp, { revoked: now - 2 * DAY, expires: now + DAY });
    await token(liveApp, { revoked: now - 40 * DAY, expires: now + DAY });
    await token(liveApp, { revoked: now - 5 * DAY, expires: now + DAY });
    await token(liveApp, { expires: now - 45 * DAY });
    await token(workingApp, { expires: now + 20 * DAY });
    // Retired a month ago, but not an agent's app: kept.
    await token(ssoApp, { revoked: now - 60 * DAY, expires: now + DAY });
    const accessToken = (clientId: string, expires: number) => sql`
      INSERT INTO "oauthAccessToken" (
        "id", "token", "clientId", "userId", "referenceId", "expiresAt",
        "createdAt", "scopes"
      ) VALUES (
        gen_random_uuid(), ${randomUUID()}, ${clientId}, ${mia.userId}, ${acme},
        ${new Date(expires)}, ${new Date(now - 50 * DAY)},
        ${sql.json(['tale:mcp'])}
      )
    `;
    await accessToken(liveApp, now - 45 * DAY);
    await accessToken(liveApp, now + DAY);
    await accessToken(ssoApp, now - 45 * DAY);
    const connectionRow = (
      appId: string,
      userId: string,
      endedAt: number | null,
    ) => sql`
      INSERT INTO app.agent_connections (
        id, org_id, user_id, client_id, client_name, client_provenance,
        redirect_host, scopes, created_at_ms, updated_at_ms, revoked_at_ms,
        revoked_by, revoke_reason
      ) VALUES (
        ${randomUUID()}, ${acme}, ${userId}, ${appId}, 'Seeded agent',
        'registered', 'localhost', ${['tale:mcp']}::text[], ${now - 200 * DAY},
        ${now - 200 * DAY}, ${endedAt}, ${endedAt === null ? null : 'system'},
        ${endedAt === null ? null : 'membership_ended'}
      )
    `;
    await connectionRow(liveApp, mia.userId, null);
    await connectionRow(freshApp, ada.userId, now - 100 * DAY);
    await connectionRow(freshApp, noah.userId, now - 10 * DAY);
    const run = createTaskList({ sql })['maintenance.agent_connections_gc'];
    if (run !== undefined) await run({});
    const appsLeft = (
      await sql<{ clientId: string }[]>`
        SELECT "clientId" FROM "oauthClient"
        WHERE "clientId" = ANY(${seededApps})
      `
    )
      .map((row) => row.clientId)
      .sort();
    const staleLeft = await sql<{ n: number }[]>`
      SELECT (SELECT count(*)::int FROM "oauthConsent" WHERE "clientId" = ${staleApp})
           + (SELECT count(*)::int FROM "oauthRefreshToken" WHERE "clientId" = ${staleApp}) AS n
    `;
    const tokensLeft = await sql<{ revoked: Date | null; expires: Date }[]>`
      SELECT "revoked", "expiresAt" AS expires FROM "oauthRefreshToken"
      WHERE "clientId" = ${liveApp} ORDER BY "createdAt", "expiresAt"
    `;
    const othersTokens = await sql<{ n: number }[]>`
      SELECT (SELECT count(*)::int FROM "oauthRefreshToken" WHERE "clientId" = ${ssoApp})
           + (SELECT count(*)::int FROM "oauthAccessToken" WHERE "clientId" = ${ssoApp}) AS n
    `;
    const liveAccess = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "oauthAccessToken" WHERE "clientId" = ${liveApp}
    `;
    const seededEnded = await sql<{ client: string; endedAgo: number }[]>`
      SELECT client_id AS client,
             round((${now} - revoked_at_ms) / ${DAY})::int AS "endedAgo"
      FROM app.agent_connections
      WHERE client_id = ANY(${seededApps}) AND revoked_at_ms IS NOT NULL
    `;
    record(
      'agent lifecycle: the daily clean-up removes an app nobody connected with what hangs off it, keeps one a person connected, one with a working token, one made recently, an organization’s or a person’s own and one that asks for no agent access, removes the tokens retired a month ago and the connections ended three months ago — and runs as the scheduled job (AGCONN-R19)',
      JSON.stringify(appsLeft) ===
        JSON.stringify(
          [freshApp, liveApp, ownedApp, plainApp, ssoApp, workingApp].sort(),
        ) &&
        staleLeft[0]?.n === 0 &&
        // Of the live app's tokens only the ones retired a month ago go.
        tokensLeft.length === 1 &&
        tokensLeft[0]?.revoked instanceof Date &&
        liveAccess[0]?.n === 1 &&
        // Nothing of an application that is not an agent's.
        othersTokens[0]?.n === 2 &&
        seededEnded.length === 1 &&
        seededEnded[0]?.endedAgo === 10,
      `apps left=${JSON.stringify(appsLeft)}, stale rows=${staleLeft[0]?.n}, live app tokens=${JSON.stringify(tokensLeft)} access=${liveAccess[0]?.n}, others=${othersTokens[0]?.n}, ended=${JSON.stringify(seededEnded)}`,
    );
  } finally {
    await sql`DELETE FROM "oauthClient" WHERE "clientId" = ${DOCUMENT_URL}`;
    if (seededApps.length > 0) {
      await sql`DELETE FROM "oauthClient" WHERE "clientId" = ANY(${seededApps})`;
      await sql`DELETE FROM app.agent_connections WHERE client_id = ANY(${seededApps})`;
    }
    if (savedSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = savedSiteUrl;
  }
}
