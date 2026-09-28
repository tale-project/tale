/** Real Postgres proof that a connector consent lands where its intent says
 * (#3711). Add credential stores a NEW credential and never renews the
 * connector's default; Reconnect renews exactly the credential its row named
 * — id, name, default flag and references kept — or saves nothing when that
 * credential is gone. The intent rides the pending authorization row the
 * start door minted (migration 0131), so an expired or tampered one, a
 * denied consent, a member who lost the role mid-consent and a row the
 * previous image minted all behave; two Adds completing at once number past
 * each other; Slack keeps one credential per workspace.
 *
 * The start door runs over HTTP. The consent completes at the service seam
 * with an injected token endpoint answered in process — no vendor is called. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { hashStateToken } from '../../core/http_connectors/oauth_state.ts';
import {
  createCredential,
  deleteCredential,
  updateCredential,
} from '../connector_credentials/service.ts';
import {
  completeOauth2,
  resolveTeamRoute,
  type CallbackOutcome,
} from './oauth.ts';

type RecordCheck = (name: string, ok: boolean, detail: string) => void;

interface StoredRow {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
  statusDetail: string | null;
  maskedPreview: string | null;
  sealed: string;
  createdAt: number;
  updatedAt: number;
  inboundSince: number | null;
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
}

async function signUp(
  base: string,
  label: string,
): Promise<{ cookie: string; userId: string }> {
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      email: `itest-${label}-${randomUUID().slice(0, 8)}@example.com`,
      password: 'itest-password-1',
      name: `Itest ${label}`,
    }),
  });
  const body = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await response.json());
  return {
    cookie: cookieOf(response),
    userId: body.success ? body.data.user.id : '',
  };
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

export async function checkConnectorOauthIntent(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const owner = await signUp(base, `oauth-intent-owner-${suffix}`);
  const orgResponse = await fetch(`${base}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: owner.cookie,
      origin: base,
    },
    body: JSON.stringify({
      name: 'OAuth intent',
      slug: `oauth-intent-${suffix}`,
    }),
  });
  const orgBody = z
    .object({ id: z.string() })
    .safeParse(await orgResponse.json());
  const orgId = orgBody.success ? orgBody.data.id : '';
  const headers = { cookie: owner.cookie, origin: base };

  const saved = {
    siteUrl: process.env.SITE_URL,
    slackId: process.env.CONNECTOR_OAUTH_SLACK_CLIENT_ID,
    slackSecret: process.env.CONNECTOR_OAUTH_SLACK_CLIENT_SECRET,
  };
  process.env.SITE_URL = base;
  process.env.CONNECTOR_OAUTH_SLACK_CLIENT_ID = 'itest-intent-slack-client';
  process.env.CONNECTOR_OAUTH_SLACK_CLIENT_SECRET = 'itest-intent-slack-secret';
  try {
    // Organization OAuth apps through the real admin door, the way the
    // settings card registers them. Synthetic client ids only.
    const apps = await Promise.all(
      ['gmail', 'outlook'].map(
        async (slug) =>
          (
            await fetch(
              `${base}/api/app/connector-oauth-apps/${slug}?orgId=${orgId}`,
              {
                method: 'PUT',
                headers: { ...headers, 'content-type': 'application/json' },
                body: JSON.stringify({
                  clientId: `itest-intent-${slug}.apps.local`,
                  clientSecret: `itest-intent-${slug}-secret`,
                }),
              },
            )
          ).status,
      ),
    );

    // ---- the token endpoint, answered in process ------------------------
    // `account` is who "consents" next; the access token starts with it, so
    // the stored masked preview (first 4 + last 2) names the account.
    const vendor = {
      account: 'ACCA',
      reject: false,
      calls: [] as string[],
      /** When set, every exchange waits here — lets two completions overlap. */
      gate: null as Promise<void> | null,
      counter: 0,
    };
    const tokenUrls = new Set([
      'https://oauth2.googleapis.com/token',
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      'https://slack.com/api/oauth.v2.access',
    ]);
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString();
      if (!tokenUrls.has(url)) {
        throw new Error(`itest fake vendor: unexpected token URL ${url}`);
      }
      const account = vendor.account;
      vendor.calls.push(`${url} ${account}`);
      if (vendor.gate !== null) await vendor.gate;
      if (vendor.reject) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      const body = new URLSearchParams(
        typeof init?.body === 'string' ? init.body : '',
      );
      vendor.counter += 1;
      const n = String(vendor.counter).padStart(6, '0');
      const tokens = {
        access_token: `${account}.itest.${n}`,
        refresh_token: `rt.${account}.${n}`,
        expires_in: 3600,
        scope: body.get('grant_type') === 'authorization_code' ? 'x' : 'y',
      };
      return Response.json(
        url.startsWith('https://slack.com/')
          ? {
              ok: true,
              ...tokens,
              team: { id: `T-${account}-${suffix}`, name: `Team ${account}` },
            }
          : tokens,
      );
    };

    // ---- helpers ------------------------------------------------------------
    const pendingCount = async () =>
      Number(
        (
          await sql<{ count: string }[]>`
            SELECT count(*)::text AS count FROM app.connector_oauth_states
            WHERE org_id = ${orgId}
          `
        )[0]?.count ?? '-1',
      );
    const rows = async (slug: string): Promise<StoredRow[]> =>
      sql<StoredRow[]>`
        SELECT id, name, is_default AS "isDefault", status,
               status_detail AS "statusDetail",
               masked_preview AS "maskedPreview",
               encrypted_data::text AS sealed,
               created_at_ms::float8 AS "createdAt",
               updated_at_ms::float8 AS "updatedAt",
               mail_sync_inbound_since_ms::float8 AS "inboundSince"
        FROM app.connector_credentials
        WHERE org_id = ${orgId} AND connector_slug = ${slug}
        ORDER BY created_at_ms, name
      `;
    const show = (list: StoredRow[]) =>
      list
        .map(
          (row) =>
            `${row.name}${row.isDefault ? '*' : ''}=${row.maskedPreview ?? '-'}/${row.status}`,
        )
        .join(' | ');
    /** The start door over HTTP; the state from the vendor redirect. */
    const start = async (
      slug: string,
      credentialId?: string,
      cookie = owner.cookie,
    ) => {
      const query = new URLSearchParams({
        connector: slug,
        organizationId: orgId,
      });
      if (credentialId !== undefined) query.set('credentialId', credentialId);
      const response = await fetch(
        `${base}/api/connectors/oauth2/start?${query.toString()}`,
        { redirect: 'manual', headers: { cookie, origin: base } },
      );
      const location = response.headers.get('location') ?? '';
      const state =
        location === ''
          ? ''
          : (new URL(location).searchParams.get('state') ?? '');
      return { status: response.status, state, body: await response.text() };
    };
    const complete = (
      state: string,
      userId = owner.userId,
      vendorError: string | null = null,
    ): Promise<CallbackOutcome> =>
      completeOauth2(
        sql,
        {
          state,
          code: vendorError === null ? `code-${randomUUID()}` : null,
          vendorError,
          requesterUserId: userId,
        },
        { fetchImpl },
      );
    const consent = async (
      slug: string,
      account: string,
      credentialId?: string,
    ) => {
      vendor.account = account;
      const started = await start(slug, credentialId);
      return { started, outcome: await complete(started.state) };
    };
    const outcomeOf = (outcome: CallbackOutcome) =>
      outcome.kind === 'error' ? `error/${outcome.error}` : 'connected';

    const column = await sql<{ nullable: string }[]>`
      SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'connector_oauth_states'
        AND column_name = 'reconnect_credential_id'
    `;

    // ---- 1. two Adds: a second account is a second credential -----------
    const first = await consent('gmail', 'ACCA');
    const afterFirst = await rows('gmail');
    const second = await consent('gmail', 'ACCB');
    const afterSecond = await rows('gmail');
    const gmail = afterFirst[0];
    const gmailAfter = afterSecond.find((row) => row.id === gmail?.id);
    const added = afterSecond.find((row) => row.id !== gmail?.id);
    record(
      'connector oauth intent: a second Add stores a new credential and leaves the default grant as it was (#3711)',
      column[0]?.nullable === 'YES' &&
        apps.every((status) => status === 200) &&
        first.started.status === 302 &&
        first.outcome.kind === 'connected' &&
        second.outcome.kind === 'connected' &&
        afterFirst.length === 1 &&
        gmail?.name === 'Gmail' &&
        gmail.isDefault &&
        (gmail.maskedPreview ?? '').startsWith('ACCA') &&
        afterSecond.length === 2 &&
        JSON.stringify(gmailAfter) === JSON.stringify(gmail) &&
        added?.name === 'Gmail 2' &&
        !added.isDefault &&
        (added.maskedPreview ?? '').startsWith('ACCB'),
      `column=${column[0]?.nullable ?? 'MISSING'} (want YES), apps=${apps.join('/')}, outcomes=${outcomeOf(first.outcome)}/${outcomeOf(second.outcome)}, after first=${show(afterFirst)}, after second=${show(afterSecond)} (want Gmail*=ACCA… unchanged | Gmail 2=ACCB…)`,
    );

    // ---- 2. the start door keeps a target only when it is ours ----------
    const github = await createCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'github',
      authMethod: 'bearer',
      name: 'GitHub bot',
      secret: { token: 'ghp_itest_intent' },
      createdBy: owner.userId,
    });
    const foreignOrg = `itest-intent-foreign-${suffix}`;
    const foreign = await createCredential(sql, {
      organizationId: foreignOrg,
      connectorSlug: 'gmail',
      authMethod: 'oauth2',
      name: 'Gmail',
      secret: { accessToken: 'FORE.itest.000000', scopes: ['x'] },
      createdBy: owner.userId,
    });
    const pendingBefore = await pendingCount();
    const refusals = await Promise.all(
      [
        ['another connector', github.credentialId],
        ['another organization', foreign.credentialId],
        ['an unknown id', randomUUID()],
        ['an empty id', ''],
      ].map(async ([what, id]) => {
        const started = await start('gmail', id);
        return {
          what,
          ok:
            started.status === 404 &&
            started.state === '' &&
            started.body.includes('This credential cannot be reconnected'),
          status: started.status,
        };
      }),
    );
    const pendingAfter = await pendingCount();
    const kept = await start('gmail', added?.id ?? '');
    const keptRow = await sql<{ target: string | null }[]>`
      SELECT reconnect_credential_id AS target FROM app.connector_oauth_states
      WHERE state_hash = ${await hashStateToken(kept.state)}
    `;
    const plainAdd = await start('gmail');
    const plainRow = await sql<{ target: string | null }[]>`
      SELECT reconnect_credential_id AS target FROM app.connector_oauth_states
      WHERE state_hash = ${await hashStateToken(plainAdd.state)}
    `;
    record(
      'connector oauth intent: the start door keeps a Reconnect target only when it is this organization’s OAuth grant of that connector',
      refusals.every((entry) => entry.ok) &&
        pendingAfter === pendingBefore &&
        kept.status === 302 &&
        keptRow[0]?.target === added?.id &&
        plainAdd.status === 302 &&
        plainRow.length === 1 &&
        plainRow[0]?.target === null,
      `${refusals.map((entry) => `${entry.what}=${entry.status}${entry.ok ? '' : ' (WRONG)'}`).join(', ')} (want 404, no state), pending minted by refusals=${pendingAfter - pendingBefore} (want 0), own target=${kept.status}/${keptRow[0]?.target === added?.id ? 'carried' : 'LOST'}, add=${plainAdd.status}/${plainRow[0]?.target === null ? 'null' : 'SET'}`,
    );

    // ---- 3. Reconnect renews exactly the named row ------------------------
    const sales = await createCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'gmail',
      authMethod: 'oauth2',
      name: 'Gmail sales',
      secret: { accessToken: 'SALE.itest.000000', scopes: ['x'] },
      createdBy: owner.userId,
    });
    await updateCredential(sql, {
      organizationId: orgId,
      credentialId: sales.credentialId,
      status: 'needs-reauth',
      statusDetail: 'itest: token revoked',
    });
    // A reference the renewal must keep: the mailbox sync's cursor.
    await sql`
      UPDATE app.connector_credentials SET mail_sync_inbound_since_ms = 1700000000000
      WHERE id = ${sales.credentialId}
    `;
    const beforeReconnect = await rows('gmail');
    const reconnected = await consent('gmail', 'ACCS', sales.credentialId);
    const afterReconnect = await rows('gmail');
    const salesBefore = beforeReconnect.find(
      (row) => row.id === sales.credentialId,
    );
    const salesAfter = afterReconnect.find(
      (row) => row.id === sales.credentialId,
    );
    const othersUnchanged =
      JSON.stringify(
        afterReconnect.filter((row) => row.id !== sales.credentialId),
      ) ===
      JSON.stringify(
        beforeReconnect.filter((row) => row.id !== sales.credentialId),
      );
    const audit = await sql<{ actorId: string }[]>`
      SELECT actor_id AS "actorId" FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'connector_credential'
        AND resource_id = ${sales.credentialId}
        AND action = 'connector_credential.updated'
      ORDER BY ts DESC LIMIT 1
    `;
    record(
      'connector oauth intent: Reconnect renews exactly the credential its row named — id, name, default and references kept (#3711)',
      reconnected.outcome.kind === 'connected' &&
        afterReconnect.length === beforeReconnect.length &&
        salesAfter !== undefined &&
        salesAfter.name === 'Gmail sales' &&
        !salesAfter.isDefault &&
        salesAfter.createdAt === salesBefore?.createdAt &&
        salesAfter.inboundSince === 1_700_000_000_000 &&
        salesAfter.status === 'active' &&
        salesAfter.statusDetail === null &&
        (salesAfter.maskedPreview ?? '').startsWith('ACCS') &&
        salesAfter.sealed !== salesBefore?.sealed &&
        othersUnchanged &&
        audit[0]?.actorId === owner.userId,
      `outcome=${outcomeOf(reconnected.outcome)}, before=${show(beforeReconnect)}, after=${show(afterReconnect)}, othersUnchanged=${othersUnchanged}, cursorKept=${salesAfter?.inboundSince === 1_700_000_000_000}, auditActor=${audit[0]?.actorId === owner.userId ? 'initiator' : (audit[0]?.actorId ?? 'none')}`,
    );

    // ---- 4. a denied consent, and a vendor that refuses the code ----------
    const beforeDenied = await rows('gmail');
    vendor.account = 'ACCX';
    const deniedStart = await start('gmail', sales.credentialId);
    const callsBeforeDenied = vendor.calls.length;
    const denied = await complete(
      deniedStart.state,
      owner.userId,
      'access_denied',
    );
    const callsAfterDenied = vendor.calls.length;
    vendor.reject = true;
    const refused = await consent('gmail', 'ACCX', sales.credentialId);
    vendor.reject = false;
    const afterDenied = await rows('gmail');
    record(
      'connector oauth intent: a denied or refused consent on Reconnect leaves every credential as it was',
      outcomeOf(denied) === 'error/vendor_declined' &&
        callsAfterDenied === callsBeforeDenied &&
        outcomeOf(refused.outcome) === 'error/vendor_declined' &&
        JSON.stringify(afterDenied) === JSON.stringify(beforeDenied),
      `denied=${outcomeOf(denied)} (exchanges ${callsAfterDenied - callsBeforeDenied}, want 0), refused=${outcomeOf(refused.outcome)}, unchanged=${JSON.stringify(afterDenied) === JSON.stringify(beforeDenied)}`,
    );

    // ---- 5. an expired or tampered intent -----------------------------
    const expiring = await start('gmail', sales.credentialId);
    await sql`
      UPDATE app.connector_oauth_states SET expires_at_ms = ${Date.now() - 1}
      WHERE state_hash = ${await hashStateToken(expiring.state)}
    `;
    const callsBeforeExpired = vendor.calls.length;
    const expired = await complete(expiring.state);
    const tamperedStart = await start('gmail', sales.credentialId);
    const tampered = await complete(`${tamperedStart.state.slice(0, -2)}xx`);
    const leftover = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.connector_oauth_states
      WHERE state_hash = ${await hashStateToken(expiring.state)}
    `;
    const afterExpired = await rows('gmail');
    record(
      'connector oauth intent: an expired or tampered state writes nothing and redeems no code',
      outcomeOf(expired) === 'error/invalid_state' &&
        outcomeOf(tampered) === 'error/invalid_state' &&
        leftover[0]?.count === '0' &&
        vendor.calls.length === callsBeforeExpired &&
        JSON.stringify(afterExpired) === JSON.stringify(afterDenied),
      `expired=${outcomeOf(expired)}, tampered=${outcomeOf(tampered)} (want invalid_state), expiredRowLeft=${leftover[0]?.count} (want 0, burned), exchanges=${vendor.calls.length - callsBeforeExpired} (want 0), unchanged=${JSON.stringify(afterExpired) === JSON.stringify(afterDenied)}`,
    );

    // ---- 6. the Reconnect target removed mid-consent --------------------
    const doomed = await createCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'gmail',
      authMethod: 'oauth2',
      name: 'Gmail doomed',
      secret: { accessToken: 'DOOM.itest.000000', scopes: ['x'] },
      createdBy: owner.userId,
    });
    vendor.account = 'ACCR';
    const doomedStart = await start('gmail', doomed.credentialId);
    await deleteCredential(sql, orgId, doomed.credentialId);
    const beforeGone = await rows('gmail');
    const callsBeforeGone = vendor.calls.length;
    const gone = await complete(doomedStart.state);
    const callsAfterGone = vendor.calls.length;
    const afterGone = await rows('gmail');

    // The race: the delete is in flight (uncommitted) when the consent
    // returns. The pre-check still sees the row and the code is redeemed,
    // but the store's row lock queues behind the delete — and then finds
    // nothing to write. Nothing may land on a sibling.
    const racer = await createCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'gmail',
      authMethod: 'oauth2',
      name: 'Gmail raced',
      secret: { accessToken: 'RACE.itest.000000', scopes: ['x'] },
      createdBy: owner.userId,
    });
    const racerStart = await start('gmail', racer.credentialId);
    const beforeRace = (await rows('gmail')).filter(
      (row) => row.id !== racer.credentialId,
    );
    let releaseDelete: () => void = () => undefined;
    const deleteReleased = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    let deleteHeld: () => void = () => undefined;
    const deleteInPlace = new Promise<void>((resolve) => {
      deleteHeld = resolve;
    });
    const deleting = sql.begin(async (tx) => {
      await tx`DELETE FROM app.connector_credentials WHERE id = ${racer.credentialId}`;
      deleteHeld();
      await deleteReleased;
    });
    await deleteInPlace;
    const racing = complete(racerStart.state);
    const queuedBehindDelete = await waitUntil(async () => {
      const waiting = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE%'
          AND query ILIKE '%connector_credentials%'
      `;
      return waiting[0]?.count !== '0';
    }, 10_000);
    releaseDelete();
    await deleting;
    const raced = await racing;
    const afterRace = await rows('gmail');
    record(
      'connector oauth intent: a Reconnect whose credential is removed mid-consent saves nothing and touches no sibling',
      outcomeOf(gone) === 'error/credential_missing' &&
        callsAfterGone === callsBeforeGone &&
        JSON.stringify(afterGone) === JSON.stringify(beforeGone) &&
        queuedBehindDelete &&
        outcomeOf(raced) === 'error/credential_missing' &&
        JSON.stringify(afterRace) === JSON.stringify(beforeRace),
      `deleted before the callback=${outcomeOf(gone)} (exchanges ${callsAfterGone - callsBeforeGone}, want 0), unchanged=${JSON.stringify(afterGone) === JSON.stringify(beforeGone)}; deleted during the store=${outcomeOf(raced)}, queuedBehindDelete=${queuedBehindDelete}, siblingsUnchanged=${JSON.stringify(afterRace) === JSON.stringify(beforeRace)}`,
    );

    // ---- 7. two Adds completing at once --------------------------------
    // A connector with no credential yet: both would otherwise take its
    // display name and the default, and one would die on a unique index.
    vendor.account = 'ACCC';
    const [one, two] = [await start('outlook'), await start('outlook')];
    let openGate: () => void = () => undefined;
    vendor.gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const both = Promise.all([complete(one.state), complete(two.state)]);
    const bothExchanging = await waitUntil(
      async () =>
        vendor.calls.filter((call) => call.includes('microsoftonline'))
          .length >= 2,
      10_000,
    );
    openGate();
    const outcomes = await both;
    vendor.gate = null;
    const outlook = await rows('outlook');
    record(
      'connector oauth intent: two Adds completing at once store two credentials under distinct names, one of them the default',
      bothExchanging &&
        outcomes.every((outcome) => outcome.kind === 'connected') &&
        outlook.length === 2 &&
        new Set(outlook.map((row) => row.name)).size === 2 &&
        outlook.some((row) => row.name === 'Microsoft Outlook') &&
        outlook.some((row) => row.name === 'Microsoft Outlook 2') &&
        outlook.filter((row) => row.isDefault).length === 1,
      `overlapping=${bothExchanging}, outcomes=${outcomes.map(outcomeOf).join('/')}, rows=${show(outlook)} (want Microsoft Outlook + Microsoft Outlook 2, one default)`,
    );

    // ---- 8. the initiator's access, re-checked at the callback ----------
    const developer = await signUp(base, `oauth-intent-dev-${suffix}`);
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (gen_random_uuid(), ${orgId}, ${developer.userId}, 'developer', ${new Date()})
    `;
    const beforeDemotion = await rows('gmail');
    const demotedStart = await start('gmail', undefined, developer.cookie);
    await sql`
      UPDATE "member" SET "role" = 'member'
      WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
    `;
    const callsBeforeDemoted = vendor.calls.length;
    const demoted = await complete(demotedStart.state, developer.userId);
    await sql`
      UPDATE "member" SET "role" = 'developer'
      WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
    `;
    const removedStart = await start(
      'gmail',
      sales.credentialId,
      developer.cookie,
    );
    await sql`
      DELETE FROM "member"
      WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
    `;
    const removed = await complete(removedStart.state, developer.userId);
    const afterAccess = await rows('gmail');
    record(
      'connector oauth intent: a member who lost the role or left while the vendor asked for consent stores nothing',
      demotedStart.status === 302 &&
        removedStart.status === 302 &&
        outcomeOf(demoted) === 'error/forbidden' &&
        outcomeOf(removed) === 'error/forbidden' &&
        vendor.calls.length === callsBeforeDemoted &&
        JSON.stringify(afterAccess) === JSON.stringify(beforeDemotion),
      `starts=${demotedStart.status}/${removedStart.status} (want 302), demoted=${outcomeOf(demoted)}, removed=${outcomeOf(removed)} (want forbidden), exchanges=${vendor.calls.length - callsBeforeDemoted} (want 0), unchanged=${JSON.stringify(afterAccess) === JSON.stringify(beforeDemotion)}`,
    );

    // Revocation can also finish while the token endpoint is in flight.
    // The pre-exchange check already passed; no grant may be saved using it.
    for (const revocation of ['demoted', 'removed'] as const) {
      await sql`
        DELETE FROM "member"
        WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
      `;
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
        VALUES (gen_random_uuid(), ${orgId}, ${developer.userId}, 'developer', ${new Date()})
      `;
      const waitingStart = await start(
        'gmail',
        sales.credentialId,
        developer.cookie,
      );
      const beforeWaiting = await rows('gmail');
      const callsBeforeWaiting = vendor.calls.length;
      let releaseExchange: () => void = () => undefined;
      vendor.gate = new Promise<void>((resolve) => {
        releaseExchange = resolve;
      });
      const waiting = complete(waitingStart.state, developer.userId);
      const exchanging = await waitUntil(
        async () => vendor.calls.length > callsBeforeWaiting,
        10_000,
      );
      if (revocation === 'demoted') {
        await sql`
          UPDATE "member" SET "role" = 'member'
          WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
        `;
      } else {
        await sql`
          DELETE FROM "member"
          WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
        `;
      }
      releaseExchange();
      const settled = await waiting;
      vendor.gate = null;
      const afterWaiting = await rows('gmail');
      record(
        `connector oauth intent: ${revocation} during token exchange stores nothing`,
        waitingStart.status === 302 &&
          exchanging &&
          outcomeOf(settled) === 'error/forbidden' &&
          JSON.stringify(afterWaiting) === JSON.stringify(beforeWaiting),
        `exchanging=${exchanging}, outcome=${outcomeOf(settled)} (want forbidden), unchanged=${JSON.stringify(afterWaiting) === JSON.stringify(beforeWaiting)}`,
      );
    }

    // The revocation can already hold the member row when the callback's
    // unlocked pre-check reads the old role. The store must wait and then
    // check the committed role, not authorize from that earlier snapshot.
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (gen_random_uuid(), ${orgId}, ${developer.userId}, 'developer', ${new Date()})
    `;
    const revokingStart = await start('gmail', undefined, developer.cookie);
    const beforeRevoking = await rows('gmail');
    let releaseRevocation: () => void = () => undefined;
    const revocationReleased = new Promise<void>((resolve) => {
      releaseRevocation = resolve;
    });
    let holdRevocation: () => void = () => undefined;
    const revocationHeld = new Promise<void>((resolve) => {
      holdRevocation = resolve;
    });
    const revoking = sql.begin(async (tx) => {
      await tx`
        UPDATE "member" SET "role" = 'member'
        WHERE "organizationId" = ${orgId} AND "userId" = ${developer.userId}
      `;
      holdRevocation();
      await revocationReleased;
    });
    await revocationHeld;
    const waitingForRevocation = complete(
      revokingStart.state,
      developer.userId,
    );
    const queuedBehindRevocation = await waitUntil(async () => {
      const waiting = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query ILIKE '%FOR SHARE%' AND query ILIKE '%"member"%'
      `;
      return waiting[0]?.count !== '0';
    }, 10_000);
    releaseRevocation();
    await revoking;
    const revokedWhileWaiting = await waitingForRevocation;
    const afterRevoking = await rows('gmail');
    record(
      'connector oauth intent: a store queued behind a membership revocation checks the committed role',
      queuedBehindRevocation &&
        outcomeOf(revokedWhileWaiting) === 'error/forbidden' &&
        JSON.stringify(afterRevoking) === JSON.stringify(beforeRevoking),
      `queued=${queuedBehindRevocation}, outcome=${outcomeOf(revokedWhileWaiting)} (want forbidden), unchanged=${JSON.stringify(afterRevoking) === JSON.stringify(beforeRevoking)}`,
    );

    // ---- 9. a pending row the previous image minted ----------------------
    // Written with the old column list — no reconnect_credential_id. It
    // must read as an Add: a new credential, the default untouched.
    const legacyState = `itest-intent-legacy-${suffix}`;
    const now = Date.now();
    await sql`
      INSERT INTO app.connector_oauth_states (
        state_hash, org_id, user_id, connector_slug, code_verifier,
        redirect_uri, created_at_ms, expires_at_ms
      ) VALUES (
        ${await hashStateToken(legacyState)}, ${orgId}, ${owner.userId},
        'gmail', 'itest-verifier-value-legacy-000000000000000',
        ${`${base}/api/connectors/oauth2/callback`}, ${now}, ${now + 60_000}
      )
    `;
    const beforeLegacy = await rows('gmail');
    vendor.account = 'ACCL';
    const legacy = await complete(legacyState);
    const afterLegacy = await rows('gmail');
    const legacyNew = afterLegacy.filter(
      (row) => !beforeLegacy.some((old) => old.id === row.id),
    );
    record(
      'connector oauth intent: a pending row the previous image minted completes as an Add and overwrites nothing',
      legacy.kind === 'connected' &&
        legacyNew.length === 1 &&
        (legacyNew[0]?.maskedPreview ?? '').startsWith('ACCL') &&
        beforeLegacy.every(
          (old) =>
            JSON.stringify(afterLegacy.find((row) => row.id === old.id)) ===
            JSON.stringify(old),
        ),
      `outcome=${outcomeOf(legacy)}, new=${show(legacyNew)}, existing unchanged=${beforeLegacy.every((old) => JSON.stringify(afterLegacy.find((row) => row.id === old.id)) === JSON.stringify(old))}`,
    );

    // ---- 10. Slack: one credential per workspace -------------------------
    await consent('slack', 'WSA');
    await consent('slack', 'WSB');
    const slackTwo = await rows('slack');
    const again = await consent('slack', 'WSA');
    const slackAgain = await rows('slack');
    const wsa = slackTwo.find((row) => row.name === 'Slack');
    const wsb = slackTwo.find((row) => row.name === 'Slack (Team WSB)');
    const wsaAgain = slackAgain.find((row) => row.id === wsa?.id);
    const mismatch = await consent('slack', 'WSA', wsb?.id);
    const slackMismatch = await rows('slack');
    const own = await consent('slack', 'WSB', wsb?.id);
    const slackOwn = await rows('slack');
    const wsbOwn = slackOwn.find((row) => row.id === wsb?.id);
    const routeB = await resolveTeamRoute(sql, `T-WSB-${suffix}`);
    record(
      'connector oauth intent: Slack keeps one credential per workspace, and a Reconnect into another workspace is refused',
      slackTwo.length === 2 &&
        wsa?.isDefault === true &&
        wsb !== undefined &&
        again.outcome.kind === 'connected' &&
        slackAgain.length === 2 &&
        wsaAgain !== undefined &&
        wsaAgain.sealed !== wsa.sealed &&
        outcomeOf(mismatch.outcome) === 'error/account_mismatch' &&
        JSON.stringify(slackMismatch) === JSON.stringify(slackAgain) &&
        own.outcome.kind === 'connected' &&
        wsbOwn !== undefined &&
        wsbOwn.sealed !== wsb.sealed &&
        routeB?.credentialId === wsb.id &&
        JSON.stringify(slackOwn.find((row) => row.id === wsa.id)) ===
          JSON.stringify(wsaAgain),
      `after two workspaces=${show(slackTwo)}, repeat WSA=${outcomeOf(again.outcome)} rows=${slackAgain.length} renewedWSA=${wsaAgain?.sealed !== wsa?.sealed}, reconnect WSB row in WSA=${outcomeOf(mismatch.outcome)} (want account_mismatch) unchanged=${JSON.stringify(slackMismatch) === JSON.stringify(slackAgain)}, reconnect WSB row in WSB=${outcomeOf(own.outcome)} renewed=${wsbOwn?.sealed !== wsb?.sealed} route=${routeB?.credentialId === wsb?.id}`,
    );
  } finally {
    if (saved.siteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = saved.siteUrl;
    if (saved.slackId === undefined) {
      delete process.env.CONNECTOR_OAUTH_SLACK_CLIENT_ID;
    } else process.env.CONNECTOR_OAUTH_SLACK_CLIENT_ID = saved.slackId;
    if (saved.slackSecret === undefined) {
      delete process.env.CONNECTOR_OAUTH_SLACK_CLIENT_SECRET;
    } else process.env.CONNECTOR_OAUTH_SLACK_CLIENT_SECRET = saved.slackSecret;
  }
}
