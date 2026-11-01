/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  AUDIT_WRITE_ORDER,
  signUpUser,
  withCleanup,
} from '../../integration-lane-helpers.ts';

const mintedSchema = z.looseObject({ key: z.string() });
const createdSchema = z.object({ id: z.string(), key: z.string() });
const meSchema = z.looseObject({
  organization: z.looseObject({ slug: z.string() }),
  key: z.looseObject({ owner: z.looseObject({ kind: z.string() }) }).nullable(),
});
const refusalSchema = z.looseObject({
  code: z.string().optional(),
  data: z
    .looseObject({
      organizations: z.array(z.looseObject({ slug: z.string() })).optional(),
    })
    .optional(),
});
const standingSchema = z.looseObject({ personalKeys: z.string() });
const listingSchema = z.looseObject({
  keys: z.array(
    z.looseObject({
      name: z.string().nullable(),
      owner: z.looseObject({ kind: z.string() }),
    }),
  ),
  personalKeys: z.string().optional(),
});

/**
 * An organization that turns members' own API keys off (APIKEY-R12, the
 * governance policy `personal_keys`): only an Owner or Admin may, the change
 * is audited, a member's own key is then refused at the REST door there and
 * still works in the member's other organization, the keys made there keep
 * working, the member's API keys tab is told, and turning the setting back
 * on lets the key in again.
 *
 * `ctx` is the suite's owner, whose organization turns the keys off; the
 * lane turns them back on on every path. It signs up its own member and
 * gives them a second organization of its own.
 */
export async function checkPersonalKeysPolicy(
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
  const otherOrgId = randomUUID();
  const otherSlug = `personal-keys-${suffix}`;
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${otherOrgId}, ${`Personal keys ${suffix}`}, ${otherSlug}, now())
  `;
  const person = await signUpUser(base, `personal-keys-${suffix}`);
  // A member here; a Developer in the other organization, which is what lets
  // them create a key of their own (`auth/api-key-create-gate.ts`).
  for (const [organizationId, role] of [
    [orgId, 'member'],
    [otherOrgId, 'developer'],
  ] as const) {
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${randomUUID()}, ${organizationId}, ${person.userId}, ${role},
              ${new Date()})
    `;
  }

  const save = (enabled: boolean, cookie = ctx.cookie): Promise<Response> =>
    fetch(`${base}/api/app/governance/policies/personal_keys?orgId=${orgId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base },
      body: JSON.stringify({ config: { enabled } }),
    });
  const me = async (key: string, slug?: string) => {
    const response = await fetch(`${base}/api/v1/me`, {
      headers: {
        authorization: `Bearer ${key}`,
        ...(slug !== undefined ? { 'x-organization-slug': slug } : {}),
      },
    });
    const body: unknown = await response.json().catch(() => null);
    const read = meSchema.safeParse(body);
    const refusal = refusalSchema.safeParse(body);
    return {
      status: response.status,
      slug: read.success ? read.data.organization.slug : '',
      owner: read.success ? (read.data.key?.owner.kind ?? '') : '',
      code: refusal.success ? (refusal.data.code ?? '') : '',
      listed: refusal.success
        ? (refusal.data.data?.organizations ?? []).map((o) => o.slug)
        : [],
    };
  };
  const standing = async (): Promise<string> => {
    const parsed = standingSchema.safeParse(
      await (
        await fetch(`${base}/api/app/governance/my/api-keys?orgId=${orgId}`, {
          headers: { cookie: person.cookie, origin: base },
        })
      )
        .json()
        .catch(() => null),
    );
    return parsed.success ? parsed.data.personalKeys : '';
  };
  // The Owner's list of every key that works here (APIKEY-R8): the kinds of
  // key it holds, the names of the members' own, and what it says of them.
  const everyKey = async () => {
    const parsed = listingSchema.safeParse(
      await (
        await fetch(`${base}/api/app/api-keys?orgId=${orgId}&scope=all`, {
          headers: { cookie: ctx.cookie, origin: base },
        })
      )
        .json()
        .catch(() => null),
    );
    const keys = parsed.success ? parsed.data.keys : [];
    return {
      kinds: [...new Set(keys.map((key) => key.owner.kind))].sort(),
      personal: keys
        .filter((key) => key.owner.kind === 'personal')
        .map((key) => key.name),
      personalKeys: parsed.success ? (parsed.data.personalKeys ?? '') : '',
    };
  };

  // The member's own key, and the keys the Owner makes here.
  const minted = mintedSchema.safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: person.cookie,
          origin: base,
        },
        body: JSON.stringify({ name: `itest-personal-${suffix}` }),
      })
    )
      .json()
      .catch(() => null),
  );
  const ownKey = minted.success ? minted.data.key : '';
  const make = async (owner: Record<string, string>): Promise<string> => {
    const response = await fetch(`${base}/api/app/api-keys?orgId=${orgId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        origin: base,
      },
      body: JSON.stringify({ name: `Made here ${suffix}`, owner }),
    });
    const parsed = createdSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success && response.status === 201 ? parsed.data.key : '';
  };
  const memberKey = await make({ kind: 'member', userId: person.userId });
  const orgKey = await make({ kind: 'organization', role: 'member' });

  await withCleanup(
    [
      [
        'turns members’ own keys back on',
        async () => {
          const restored = await save(true);
          if (!restored.ok) throw new Error(`answered ${restored.status}`);
        },
      ],
    ],
    async () => {
      const before = await me(ownKey, orgSlug);
      const byMember = await save(false, person.cookie);
      record(
        'personal keys: a member’s own key works by default, and only an Owner or Admin may turn such keys off',
        ownKey !== '' &&
          before.status === 200 &&
          before.slug === orgSlug &&
          byMember.status === 403,
        `own key=${ownKey !== ''} before=${before.status} member's save=${byMember.status} (want 403)`,
      );

      const turnedOff = await save(false);
      const audits = await sql<
        { action: string; actorId: string | null; newState: unknown }[]
      >`
        SELECT action, actor_id AS "actorId", new_state AS "newState"
        FROM app.audit_logs
        WHERE org_id = ${orgId} AND resource_type = 'governance_policy'
          AND resource_id = 'personal_keys'
        ORDER BY ${sql.unsafe(AUDIT_WRITE_ORDER)}
      `;
      const last = audits.at(-1);
      record(
        'personal keys: turning members’ own keys off is audited under the Owner’s name',
        turnedOff.status === 200 &&
          last !== undefined &&
          ['governance_policy.created', 'governance_policy.updated'].includes(
            last.action,
          ) &&
          last.actorId === ctx.userId &&
          JSON.stringify(last.newState).includes('"enabled":false'),
        `save=${turnedOff.status} audits=${JSON.stringify(audits)}`,
      );

      const refused = await me(ownKey, orgSlug);
      const elsewhere = await me(ownKey, otherSlug);
      const told = await standing();
      record(
        'personal keys: turned off, a member’s own key is refused there, naming where it still works, and works in their other organization',
        refused.status === 403 &&
          refused.code === 'API_KEY_PERSONAL_REFUSED' &&
          refused.listed.includes(otherSlug) &&
          !refused.listed.includes(orgSlug) &&
          elsewhere.status === 200 &&
          elsewhere.slug === otherSlug &&
          told === 'refused',
        `refused=${refused.status}/${refused.code} listed=${JSON.stringify(refused.listed)} elsewhere=${elsewhere.status}/${elsewhere.slug} tab=${told}`,
      );

      const listedOff = await everyKey();
      record(
        'personal keys: turned off, the Owner’s list of every key here holds no one’s own key, theirs included, and says why',
        listedOff.personalKeys === 'refused' &&
          !listedOff.kinds.includes('personal') &&
          !listedOff.kinds.includes('user') &&
          listedOff.kinds.includes('member') &&
          listedOff.kinds.includes('organization'),
        `kinds=${JSON.stringify(listedOff.kinds)} personalKeys=${listedOff.personalKeys}`,
      );

      const asMember = await me(memberKey);
      const asOrganization = await me(orgKey);
      record(
        'personal keys: turned off, the keys made in the organization keep working there',
        memberKey !== '' &&
          orgKey !== '' &&
          asMember.status === 200 &&
          asMember.owner === 'member' &&
          asOrganization.status === 200 &&
          asOrganization.owner === 'organization',
        `member key=${asMember.status}/${asMember.owner} organization key=${asOrganization.status}/${asOrganization.owner}`,
      );

      const turnedOn = await save(true);
      const after = await me(ownKey, orgSlug);
      record(
        'personal keys: turned back on, the member’s own key works there again',
        turnedOn.status === 200 &&
          after.status === 200 &&
          (await standing()) === 'admitted',
        `save=${turnedOn.status} after=${after.status}`,
      );
      const listedOn = await everyKey();
      record(
        'personal keys: turned back on, the Owner’s list of every key here holds the member’s own key again',
        listedOn.personalKeys === 'admitted' &&
          listedOn.personal.includes(`itest-personal-${suffix}`),
        `personal=${JSON.stringify(listedOn.personal)} personalKeys=${listedOn.personalKeys}`,
      );
    },
  );
}
