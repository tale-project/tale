/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  AUDIT_WRITE_ORDER,
  signUpUser,
} from '../../integration-lane-helpers.ts';

const createdSchema = z.looseObject({ id: z.string(), key: z.string() });
const codeSchema = z.looseObject({
  code: z.string().optional(),
  data: z
    .looseObject({
      organizations: z.array(z.looseObject({ slug: z.string() })),
    })
    .optional(),
});
const listedSchema = z.looseObject({
  keys: z.array(z.looseObject({ id: z.string(), blockedHere: z.boolean() })),
});
const memberKeysSchema = z.looseObject({
  keys: z.array(
    z.looseObject({
      id: z.string(),
      blocked: z
        .looseObject({ by: z.looseObject({ userId: z.string() }) })
        .nullable(),
    }),
  ),
  canBlock: z.boolean(),
  personalKeys: z.enum(['admitted', 'refused', 'unavailable']),
});

/**
 * An organization's block on a member's own key (APIKEY-R11, migration
 * 0231, `domains/api_keys/blocks.ts`): the suite's Owner blocks a
 * developer's own key in the suite's organization, and the REST door
 * refuses it there with `API_KEY_BLOCKED` while it still opens the
 * developer's second organization; the block is one audit row, the holder
 * is told and sees it marked in their own list, and the lift lets the key
 * in again.
 *
 * `ctx` is the suite's owner. The lane makes its own holder and second
 * organization, and deletes the second organization's rows at the end.
 */
export async function checkApiKeyOrgBlocks(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const { orgId } = ctx;
  const [org] = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId}
  `;
  const orgSlug = org?.slug ?? '';
  // The holder: a Developer of the suite's organization (the create gate
  // lets a Developer make a key of their own) and of a second organization
  // that the lane makes here and removes at the end.
  const holder = await signUpUser(base, `apikey-block-${suffix}`);
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${orgId}, ${holder.userId}, 'developer', ${new Date()})
  `;
  const minted = createdSchema.safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: holder.cookie,
          origin: base,
        },
        body: JSON.stringify({ name: `itest-key-block-${suffix}` }),
      })
    )
      .json()
      .catch(() => null),
  );
  const key = minted.success ? minted.data.key : '';
  const keyId = minted.success ? minted.data.id : '';
  const otherOrgId = `itest-key-block-${suffix}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${otherOrgId}, 'Key block fixture', ${otherOrgId}, ${new Date()})
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${otherOrgId}, ${holder.userId}, 'developer', ${new Date()})
  `;

  try {
    const appDoor = (
      method: 'GET' | 'PUT' | 'DELETE',
      route: string,
      cookie = ctx.cookie,
    ): Promise<Response> =>
      fetch(`${base}/api/app${route}?orgId=${orgId}`, {
        method,
        headers: { 'content-type': 'application/json', cookie, origin: base },
      });
    const me = async (slug: string) => {
      const response = await fetch(`${base}/api/v1/me`, {
        headers: {
          authorization: `Bearer ${key}`,
          'x-organization-slug': slug,
        },
      });
      const parsed = codeSchema.safeParse(
        await response.json().catch(() => null),
      );
      return {
        status: response.status,
        body: parsed.success ? parsed.data : null,
      };
    };
    const audits = () =>
      sql<{ action: string; actorId: string | null; state: unknown }[]>`
      SELECT action, actor_id AS "actorId",
             coalesce(new_state, previous_state) AS state
      FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'api_key'
        AND resource_id = ${keyId}
        AND action IN ('api_key.blocked', 'api_key.unblocked')
      ORDER BY ${sql.unsafe(AUDIT_WRITE_ORDER)}
    `;

    const before = await me(orgSlug);
    const blocked = await appDoor('PUT', `/api-keys/${keyId}/block`);
    const here = await me(orgSlug);
    const elsewhere = await me(otherOrgId);
    const rows = await sql<{ holder: string; by: string }[]>`
      SELECT holder_user_id AS holder, blocked_by AS by
      FROM app.api_key_org_blocks
      WHERE org_id = ${orgId} AND api_key_id = ${keyId}
    `;
    record(
      'api key blocks: a blocked personal key is refused in its organization and still works in the holder’s other one',
      before.status === 200 &&
        blocked.status === 200 &&
        here.status === 403 &&
        here.body?.code === 'API_KEY_BLOCKED' &&
        (here.body.data?.organizations.some((o) => o.slug === otherOrgId) ??
          false) &&
        !(
          here.body.data?.organizations.some((o) => o.slug === orgSlug) ?? true
        ) &&
        elsewhere.status === 200 &&
        rows[0]?.holder === holder.userId &&
        rows[0]?.by === ctx.userId,
      `before=${before.status} block=${blocked.status} here=${here.status}/${here.body?.code ?? '?'} listed=${JSON.stringify(here.body?.data?.organizations.map((o) => o.slug))} elsewhere=${elsewhere.status} row=${JSON.stringify(rows[0] ?? null)}`,
    );

    const again = await appDoor('PUT', `/api-keys/${keyId}/block`);
    const againBody = z
      .looseObject({ changed: z.boolean() })
      .safeParse(await again.json().catch(() => null));
    const notices = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.user_notifications
      WHERE user_id = ${holder.userId} AND org_id = ${orgId}
        AND type = 'api_key_blocked'
    `;
    const ownList = listedSchema.safeParse(
      await (
        await appDoor('GET', '/api-keys', holder.cookie)
      )
        .json()
        .catch(() => null),
    );
    const adminView = memberKeysSchema.safeParse(
      await (
        await appDoor('GET', `/api-keys/members/${holder.userId}/personal`)
      )
        .json()
        .catch(() => null),
    );
    const trail = await audits();
    record(
      'api key blocks: a block is one audit row by the masked key, the holder is told once and sees it marked',
      again.status === 200 &&
        againBody.success &&
        !againBody.data.changed &&
        trail.length === 1 &&
        trail[0]?.action === 'api_key.blocked' &&
        trail[0].actorId === ctx.userId &&
        !JSON.stringify(trail[0].state).includes(key) &&
        notices[0]?.count === 1 &&
        ownList.success &&
        ownList.data.keys.some((k) => k.id === keyId && k.blockedHere) &&
        adminView.success &&
        adminView.data.canBlock &&
        // The suite's organization keeps the default: members' own keys
        // are let in (APIKEY-R12).
        adminView.data.personalKeys === 'admitted' &&
        adminView.data.keys.some(
          (k) => k.id === keyId && k.blocked?.by.userId === ctx.userId,
        ),
      `again=${again.status}/${againBody.success ? String(againBody.data.changed) : '?'} trail=${JSON.stringify(trail.map((row) => row.action))} notices=${notices[0]?.count ?? 0} ownList=${ownList.success ? JSON.stringify(ownList.data.keys.map((k) => k.blockedHere)) : 'unreadable'} adminView=${adminView.success ? `${String(adminView.data.canBlock)}/${adminView.data.personalKeys}` : 'unreadable'}`,
    );

    const lifted = await appDoor('DELETE', `/api-keys/${keyId}/block`);
    const after = await me(orgSlug);
    const liftTrail = await audits();
    const liftNotices = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.user_notifications
      WHERE user_id = ${holder.userId} AND org_id = ${orgId}
        AND type = 'api_key_unblocked'
    `;
    record(
      'api key blocks: lifting the block lets the key in again, audited and told',
      lifted.status === 200 &&
        after.status === 200 &&
        liftTrail.map((row) => row.action).join(',') ===
          'api_key.blocked,api_key.unblocked' &&
        liftNotices[0]?.count === 1,
      `lift=${lifted.status} after=${after.status} trail=${JSON.stringify(liftTrail.map((row) => row.action))} notices=${liftNotices[0]?.count ?? 0}`,
    );
  } finally {
    await sql`DELETE FROM app.api_key_org_blocks WHERE api_key_id = ${keyId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${otherOrgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${otherOrgId}`;
  }
}
