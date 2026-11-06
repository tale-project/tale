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
});
const refusalSchema = z.looseObject({ error: z.string() });
const wireRefusalSchema = z.looseObject({
  error: z.looseObject({ code: z.string() }),
});

/**
 * An organization's block on a member's own key (APIKEY-R11, migration
 * 0231, `domains/api_keys/blocks.ts`): the suite's Owner blocks a
 * developer's own key in the suite's organization, and the REST door
 * refuses it there with `API_KEY_BLOCKED` while it still opens the
 * developer's second organization; the block is one audit row, the holder
 * is told and sees it marked in their own list, and the lift lets the key
 * in again. The Owner's list of every key leaves the blocked key out while
 * it lists the holder's other one, and lists it again after the lift. The
 * MCP endpoint and the model endpoints refuse the blocked key as the REST
 * routes do; the holder, an Admin here, still finds it in their own list of
 * every key, marked. Nobody blocks their own key, and a key made here for
 * a member is ended, not blocked.
 *
 * `ctx` is the suite's owner. The lane makes its own holder and second
 * organization, and deletes the second organization's rows and the keys it
 * made for the Owner and for the holder here at the end.
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
  // The holder: an Admin of the suite's organization, whose own list of
  // every key shows their own blocked key, and a Developer of a second
  // organization that the lane makes here and removes at the end.
  const holder = await signUpUser(base, `apikey-block-${suffix}`);
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${orgId}, ${holder.userId}, 'admin', ${new Date()})
  `;
  const mint = async (name: string) =>
    createdSchema.safeParse(
      await (
        await fetch(`${base}/api/auth/api-key/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: holder.cookie,
            origin: base,
          },
          body: JSON.stringify({ name }),
        })
      )
        .json()
        .catch(() => null),
    );
  const minted = await mint(`itest-key-block-${suffix}`);
  const key = minted.success ? minted.data.key : '';
  const keyId = minted.success ? minted.data.id : '';
  // A second key of the holder's own that is never blocked: the Owner's
  // list of every key keeps it while the first one is blocked (APIKEY-R8).
  const spare = await mint(`itest-key-spare-${suffix}`);
  const spareId = spare.success ? spare.data.id : '';
  const otherOrgId = `itest-key-block-${suffix}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${otherOrgId}, 'Key block fixture', ${otherOrgId}, ${new Date()})
  `;
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (${randomUUID()}, ${otherOrgId}, ${holder.userId}, 'developer', ${new Date()})
  `;

  // The keys the lane makes for the Owner and, bound here, for the holder.
  let ownKeyId = '';
  let boundKeyId = '';

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
    // Every key that works here, as an Owner or Admin lists it (APIKEY-R8),
    // or null when it cannot be read.
    const everyKey = async (cookie = ctx.cookie) => {
      const parsed = listedSchema.safeParse(
        await (
          await fetch(`${base}/api/app/api-keys?orgId=${orgId}&scope=all`, {
            headers: { cookie, origin: base },
          })
        )
          .json()
          .catch(() => null),
      );
      return parsed.success ? parsed.data.keys : null;
    };
    // The ids the Owner's list of every key shows.
    const allKeys = async () => (await everyKey())?.map((k) => k.id) ?? null;
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
    const allBefore = await allKeys();
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

    // The MCP endpoint and the model endpoints sit behind the same door: a
    // blocked key is refused there too, the model endpoints answering in
    // their vendor's error shape.
    const mcp = await fetch(`${base}/api/v1/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'x-organization-slug': orgSlug,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const mcpBody = codeSchema.safeParse(await mcp.json().catch(() => null));
    const models = await fetch(`${base}/api/v1/openai/models`, {
      headers: {
        authorization: `Bearer ${key}`,
        'x-organization-slug': orgSlug,
      },
    });
    const modelsBody = wireRefusalSchema.safeParse(
      await models.json().catch(() => null),
    );
    record(
      'api key blocks: the MCP endpoint and the model endpoints refuse the blocked key in its organization too',
      mcp.status === 403 &&
        mcpBody.success &&
        mcpBody.data.code === 'API_KEY_BLOCKED' &&
        models.status === 403 &&
        modelsBody.success &&
        modelsBody.data.error.code === 'API_KEY_BLOCKED',
      `mcp=${mcp.status}/${mcpBody.success ? (mcpBody.data.code ?? '?') : 'unreadable'} models=${models.status}/${modelsBody.success ? modelsBody.data.error.code : 'unreadable'}`,
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
    const allBlocked = await allKeys();
    const holderEveryKey = await everyKey(holder.cookie);
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
        adminView.data.keys.some(
          (k) => k.id === keyId && k.blocked?.by.userId === ctx.userId,
        ),
      `again=${again.status}/${againBody.success ? String(againBody.data.changed) : '?'} trail=${JSON.stringify(trail.map((row) => row.action))} notices=${notices[0]?.count ?? 0} ownList=${ownList.success ? JSON.stringify(ownList.data.keys.map((k) => k.blockedHere)) : 'unreadable'} adminView=${adminView.success ? String(adminView.data.canBlock) : 'unreadable'}`,
    );

    const lifted = await appDoor('DELETE', `/api-keys/${keyId}/block`);
    const after = await me(orgSlug);
    const allLifted = await allKeys();
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

    // Whether a list shows the blocked key and the spare one.
    const seen = (ids: string[] | null) =>
      ids
        ? `${String(ids.includes(keyId))}/${String(ids.includes(spareId))}`
        : 'unreadable';
    record(
      'api key blocks: every key leaves out a member’s own key while it is blocked here, keeps their other one, and lists it again once lifted',
      (allBefore?.includes(keyId) ?? false) &&
        (allBefore?.includes(spareId) ?? false) &&
        !(allBlocked?.includes(keyId) ?? true) &&
        (allBlocked?.includes(spareId) ?? false) &&
        ownList.success &&
        ownList.data.keys.some((k) => k.id === keyId && k.blockedHere) &&
        (allLifted?.includes(keyId) ?? false),
      `before=${seen(allBefore)} blocked=${seen(allBlocked)} lifted=${seen(allLifted)} ownList=${ownList.success ? String(ownList.data.keys.some((k) => k.id === keyId && k.blockedHere)) : 'unreadable'}`,
    );

    // The holder, an Admin here, lists every key too: their own blocked
    // key keeps its place there, marked, as in the keys they manage.
    record(
      'api key blocks: an Admin’s own key blocked here stays in their list of every key, marked',
      holderEveryKey?.some((k) => k.id === keyId && k.blockedHere) ?? false,
      `holderEveryKey=${holderEveryKey ? JSON.stringify(holderEveryKey.filter((k) => k.id === keyId)) : 'unreadable'}`,
    );

    // Nobody blocks their own key, and a key made here for a member is
    // bound to this organization: it is ended, not blocked.
    const ownKey = createdSchema.safeParse(
      await (
        await fetch(`${base}/api/auth/api-key/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: ctx.cookie,
            origin: base,
          },
          body: JSON.stringify({ name: `itest-own-${suffix}` }),
        })
      )
        .json()
        .catch(() => null),
    );
    ownKeyId = ownKey.success ? ownKey.data.id : '';
    const boundKey = createdSchema.safeParse(
      await (
        await fetch(`${base}/api/app/api-keys?orgId=${orgId}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: ctx.cookie,
            origin: base,
          },
          body: JSON.stringify({
            name: `itest-bound-${suffix}`,
            owner: { kind: 'member', userId: holder.userId },
          }),
        })
      )
        .json()
        .catch(() => null),
    );
    boundKeyId = boundKey.success ? boundKey.data.id : '';
    const ownRefused = await appDoor('PUT', `/api-keys/${ownKeyId}/block`);
    const ownRefusal = refusalSchema.safeParse(
      await ownRefused.json().catch(() => null),
    );
    const boundRefused = await appDoor('PUT', `/api-keys/${boundKeyId}/block`);
    const boundRefusal = refusalSchema.safeParse(
      await boundRefused.json().catch(() => null),
    );
    const strayBlocks = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.api_key_org_blocks
      WHERE api_key_id IN ${sql([ownKeyId, boundKeyId])}
    `;
    record(
      'api key blocks: nobody blocks their own key, and a key made here for a member is ended, not blocked',
      ownKey.success &&
        boundKey.success &&
        ownRefused.status === 403 &&
        ownRefusal.success &&
        ownRefusal.data.error === 'API_KEY_BLOCK_FORBIDDEN' &&
        boundRefused.status === 404 &&
        boundRefusal.success &&
        boundRefusal.data.error === 'API_KEY_NOT_FOUND' &&
        strayBlocks[0]?.count === 0,
      `own=${ownKey.success ? 'made' : 'unmade'}:${ownRefused.status}/${ownRefusal.success ? ownRefusal.data.error : '?'} bound=${boundKey.success ? 'made' : 'unmade'}:${boundRefused.status}/${boundRefusal.success ? boundRefusal.data.error : '?'} rows=${strayBlocks[0]?.count ?? '?'}`,
    );
  } finally {
    await sql`DELETE FROM app.api_key_org_blocks WHERE api_key_id = ${keyId}`;
    await sql`DELETE FROM "member" WHERE "organizationId" = ${otherOrgId}`;
    await sql`DELETE FROM "organization" WHERE "id" = ${otherOrgId}`;
    // The Owner's own key and the key made for the holder go the way each
    // is ended: the first at the api-key plugin, the second at this
    // organization's door.
    if (ownKeyId !== '') {
      await fetch(`${base}/api/auth/api-key/delete`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: JSON.stringify({ keyId: ownKeyId }),
      });
    }
    if (boundKeyId !== '') {
      await fetch(`${base}/api/app/api-keys/${boundKeyId}?orgId=${orgId}`, {
        method: 'DELETE',
        headers: { cookie: ctx.cookie, origin: base },
      });
    }
  }
}
