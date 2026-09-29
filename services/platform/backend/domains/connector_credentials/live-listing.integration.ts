/** Real Postgres proof that the connectors settings listing stays true for
 * every open tab (#3712, #3713). One admin writes credentials over the same
 * HTTP door the settings page uses; the organization's OTHER member — the
 * owner, who wrote nothing — must find one `connector_credential` hint per
 * change in the outbox their `/events` stream tails, in commit order, and a
 * refused write must add none. The listing names who a delete of the
 * default hands the default to, and the delete then makes exactly that
 * credential the default. A grant the refresh finds dead turns
 * `needs-reauth` and is hinted in the same transaction.
 *
 * No vendor is called: the credentials hold synthetic tokens, and the dead
 * grant carries no refresh token, so the seam never reaches a token URL. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { CONNECTOR_CREDENTIAL_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { signUpUser } from '../../integration-lane-helpers.ts';
import { latestOutboxId, readHintsAfter } from '../../realtime/outbox.ts';
import { createCredential, resolveConnectorCredential } from './service.ts';

type RecordCheck = (name: string, ok: boolean, detail: string) => void;

const listingSchema = z.object({
  credentials: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      connectorSlug: z.string(),
      isDefault: z.boolean(),
      status: z.string(),
      defaultSuccessor: z
        .object({ id: z.string(), name: z.string() })
        .nullable()
        .optional(),
    }),
  ),
});

export async function checkConnectorCredentialLiveListing(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const owner = await signUpUser(base, `live-listing-owner-${suffix}`);
  const admin = await signUpUser(base, `live-listing-admin-${suffix}`);
  const orgResponse = await fetch(`${base}/api/auth/organization/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: owner.cookie,
      origin: base,
    },
    body: JSON.stringify({
      name: 'Live listing',
      slug: `live-listing-${suffix}`,
    }),
  });
  const orgBody = z
    .object({ id: z.string() })
    .safeParse(await orgResponse.json());
  const orgId = orgBody.success ? orgBody.data.id : '';
  const added = await fetch(`${base}/api/app/members?orgId=${orgId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: owner.cookie,
      origin: base,
    },
    body: JSON.stringify({ userId: admin.userId, role: 'admin' }),
  });
  record(
    'live listing: an owner and a second admin share one organization',
    orgId !== '' && added.status === 200,
    `org=${orgId !== ''} addMember=${added.status}`,
  );
  if (orgId === '' || added.status !== 200) return;

  const door = (
    route: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> =>
    fetch(`${base}/api/app/connector-credentials${route}?orgId=${orgId}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        cookie: admin.cookie,
        origin: base,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const create = async (name: string): Promise<string> => {
    const res = await door('', {
      body: {
        connectorSlug: 'github',
        authMethod: 'bearer',
        name,
        secret: { token: `synthetic-${suffix}-${name.replace(/\W/g, '')}` },
      },
    });
    const parsed = z
      .object({ credentialId: z.string() })
      .safeParse(await res.json());
    return parsed.success ? parsed.data.credentialId : '';
  };
  /** What the owner's stream would deliver after `cursor`, for this org. */
  const hintsSince = async (cursor: string, userId: string) =>
    (await readHintsAfter(sql, cursor, { orgId, userId })).filter(
      (hint) => hint.entity === CONNECTOR_CREDENTIAL_HINT_ENTITY,
    );

  // 1. Every write hints the owner, who wrote none of them.
  let cursor = await latestOutboxId(sql);
  const support = await create('Support bot');
  const release = await create('Release bot');
  const paused = await create('Paused bot');
  const disabled = await door(`/${paused}`, {
    method: 'PATCH',
    body: { status: 'disabled' },
  });
  const renamed = await door(`/${release}`, {
    method: 'PATCH',
    body: { name: 'Release bot (ci)' },
  });
  const writeHints = await hintsSince(cursor, owner.userId);
  const adminSees = await hintsSince(cursor, admin.userId);
  record(
    'live listing: each credential write hints every member of the org, in commit order',
    disabled.status === 200 &&
      renamed.status === 200 &&
      writeHints.map((hint) => hint.entityId).join(',') ===
        [support, release, paused, paused, release].join(',') &&
      adminSees.length === writeHints.length,
    `hints=${writeHints.map((hint) => hint.entityId?.slice(0, 8)).join(',')} admin=${adminSees.length} disable=${disabled.status} rename=${renamed.status}`,
  );

  // 2. A refused write changes nothing and announces nothing.
  cursor = await latestOutboxId(sql);
  const refused = await door(`/${randomUUID()}`, {
    method: 'PATCH',
    body: { name: 'ghost' },
  });
  const taken = await door(`/${paused}`, {
    method: 'PATCH',
    body: { name: 'support BOT' },
  });
  record(
    'live listing: a refused write (gone, name taken) emits no hint',
    refused.status === 404 &&
      taken.status === 409 &&
      (await hintsSince(cursor, owner.userId)).length === 0,
    `gone=${refused.status} taken=${taken.status}`,
  );

  // 3. The listing names who takes the default over; the delete agrees.
  const before = listingSchema.safeParse(await (await door('')).json());
  const supportRow = before.success
    ? before.data.credentials.find((row) => row.id === support)
    : undefined;
  const pausedRow = before.success
    ? before.data.credentials.find((row) => row.id === paused)
    : undefined;
  record(
    'live listing: the default names the oldest active sibling as its successor',
    supportRow?.isDefault === true &&
      supportRow.defaultSuccessor?.id === release &&
      supportRow.defaultSuccessor.name === 'Release bot (ci)' &&
      pausedRow !== undefined &&
      !('defaultSuccessor' in pausedRow),
    `default=${supportRow?.isDefault} successor=${JSON.stringify(supportRow?.defaultSuccessor)} pausedHasField=${pausedRow !== undefined && 'defaultSuccessor' in pausedRow}`,
  );
  cursor = await latestOutboxId(sql);
  const deleted = await door(`/${support}`, { method: 'DELETE' });
  const after = listingSchema.safeParse(await (await door('')).json());
  const defaults = after.success
    ? after.data.credentials.filter((row) => row.isDefault).map((row) => row.id)
    : [];
  const releaseRow = after.success
    ? after.data.credentials.find((row) => row.id === release)
    : undefined;
  const deleteHints = await hintsSince(cursor, owner.userId);
  record(
    'live listing: deleting the default hands it to exactly the named credential, hinted once',
    deleted.status === 204 &&
      defaults.join(',') === release &&
      // Release bot is now the default; with only a disabled sibling left,
      // a delete of it would leave none.
      releaseRow?.defaultSuccessor === null &&
      deleteHints.map((hint) => hint.entityId).join(',') === support,
    `delete=${deleted.status} defaults=${defaults.map((id) => id.slice(0, 8)).join(',')} nextSuccessor=${JSON.stringify(releaseRow?.defaultSuccessor)} hints=${deleteHints.length}`,
  );

  // 4. A grant the refresh finds dead turns needs-reauth, hinted with it.
  const grant = await createCredential(sql, {
    organizationId: orgId,
    connectorSlug: 'slack',
    authMethod: 'oauth2',
    name: 'Dead grant',
    secret: {
      accessToken: `xoxb-synthetic-${suffix}`,
      expiresAt: Date.now() - 60_000,
    },
    createdBy: owner.userId,
  });
  cursor = await latestOutboxId(sql);
  let refusal = '';
  try {
    await resolveConnectorCredential(sql, {
      organizationId: orgId,
      connectorSlug: 'slack',
      credentialRef: grant.credentialId,
    });
  } catch (error) {
    refusal =
      error instanceof Error && 'code' in error
        ? String(Reflect.get(error, 'code'))
        : String(error);
  }
  const flipped = await sql<{ status: string }[]>`
    SELECT status FROM app.connector_credentials
    WHERE id = ${grant.credentialId}
  `;
  const flipHints = await hintsSince(cursor, owner.userId);
  record(
    'live listing: a dead grant flips needs-reauth and hints the org in one commit',
    refusal === 'CREDENTIAL_NEEDS_REAUTH' &&
      flipped[0]?.status === 'needs-reauth' &&
      flipHints.map((hint) => hint.entityId).join(',') === grant.credentialId,
    `refusal=${refusal} status=${flipped[0]?.status} hints=${flipHints.length}`,
  );
}
