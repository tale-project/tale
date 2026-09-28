/** Real HTTP + Postgres proof; mounted by backend/integration-check.ts. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

const refusal = z.object({
  error: z.string(),
  code: z.string(),
  data: z.object({
    organizations: z.array(
      z.strictObject({ slug: z.string(), name: z.string() }),
    ),
  }),
});

const me = z.looseObject({
  organizations: z.array(z.looseObject({ slug: z.string().nullable() })),
});

/**
 * A key whose holder belongs to several organizations sends an
 * `X-Organization-Slug` the door refuses — mistyped, not a slug at all, an
 * organization the holder is no member of, one the holder's membership in
 * is disabled — and every refusal lists the slugs the holder may send
 * under `data.organizations`, exactly the ones `GET /api/v1/me` then
 * answers with a slug from that list. Only the missing header's 400 used
 * to carry them, so a typo answered what was wrong and never what to send.
 *
 * `holder` is a throwaway user with no membership yet: the lane gives it
 * two live memberships and a disabled one, so the suite's shared user
 * stays single-organization for the REST lanes around this one.
 */
export async function checkOrgSlugRefusals(
  sql: Sql,
  base: string,
  holder: { cookie: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const org = (label: string) => ({
    id: randomUUID(),
    slug: `slug-refusal-${label}-${suffix}`,
    name: `Slug refusal ${label}`,
  });
  const alpha = org('alpha');
  const beta = org('beta');
  const retired = org('retired');
  const foreign = org('foreign');
  // `createdAt` apart, so the listing's oldest-first order is fixed.
  const createdAt = Date.now() - 60_000;
  for (const [index, row] of [alpha, beta, retired, foreign].entries()) {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${row.id}, ${row.name}, ${row.slug},
              ${new Date(createdAt + index * 1000)})
    `;
  }
  for (const [row, role] of [
    [alpha, 'member'],
    [beta, 'admin'],
    [retired, 'disabled'],
  ] as const) {
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${randomUUID()}, ${row.id}, ${holder.userId}, ${role},
              ${new Date()})
    `;
  }

  const minted = z.object({ key: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/api-key/create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: holder.cookie,
          origin: base,
        },
        body: JSON.stringify({ name: 'itest-slug-refusals' }),
      })
    ).json(),
  );
  const key = minted.success ? minted.data.key : '';
  const call = (slug?: string) =>
    fetch(`${base}/api/v1/me`, {
      headers: {
        authorization: `Bearer ${key}`,
        ...(slug === undefined ? {} : { 'X-Organization-Slug': slug }),
      },
    });
  const expected = JSON.stringify([
    { slug: alpha.slug, name: alpha.name },
    { slug: beta.slug, name: beta.name },
  ]);
  const probe = async (slug: string | undefined) => {
    const res = await call(slug);
    const body = refusal.safeParse(await res.json());
    return {
      status: res.status,
      code: body.success ? body.data.code : 'ERR',
      listed: body.success
        ? JSON.stringify(body.data.data.organizations)
        : 'ERR',
    };
  };
  const lists = (answer: { listed: string }) => answer.listed === expected;
  const show = (answer: { status: number; code: string; listed: string }) =>
    `${answer.status} ${answer.code} ${answer.listed}`;

  // One character dropped from a real slug — the typo the task names.
  const mistyped = await probe(alpha.slug.replace('alpha', 'alpa'));
  const malformed = await probe('Slug Refusal Alpha');
  const foreignSlug = await probe(foreign.slug);
  const retiredSlug = await probe(retired.slug);
  const missing = await probe(undefined);

  // The list is the choice `/me` then honours: the first slug it names
  // answers 200, and `/me` reports the same two organizations.
  const chosen = await call(alpha.slug);
  const chosenBody = me.safeParse(await chosen.json());
  const meSlugs = chosenBody.success
    ? chosenBody.data.organizations.map((row) => row.slug)
    : [];

  record(
    'REST: a mistyped X-Organization-Slug answers 404 listing the key holder’s slugs',
    minted.success &&
      mistyped.status === 404 &&
      mistyped.code === 'ORG_SLUG_INVALID' &&
      lists(mistyped),
    `key=${minted.success}, mistyped → ${show(mistyped)} (want 404 ORG_SLUG_INVALID ${expected})`,
  );
  record(
    'REST: a value that cannot be a slug answers 404 listing the key holder’s slugs',
    malformed.status === 404 &&
      malformed.code === 'ORG_SLUG_INVALID' &&
      lists(malformed),
    `malformed → ${show(malformed)} (want 404 ORG_SLUG_INVALID ${expected})`,
  );
  record(
    'REST: a foreign or disabled organization answers 403 listing the key holder’s slugs',
    foreignSlug.status === 403 &&
      foreignSlug.code === 'ORG_FORBIDDEN' &&
      lists(foreignSlug) &&
      retiredSlug.status === 403 &&
      retiredSlug.code === 'ORG_FORBIDDEN' &&
      lists(retiredSlug),
    `foreign → ${show(foreignSlug)}, disabled → ${show(retiredSlug)} (want 403 ORG_FORBIDDEN ${expected} for both)`,
  );
  record(
    'REST: the listed slugs are the ones the missing-header 400 and /me answer',
    missing.status === 400 &&
      missing.code === 'ORG_SLUG_REQUIRED' &&
      lists(missing) &&
      chosen.status === 200 &&
      JSON.stringify(meSlugs) === JSON.stringify([alpha.slug, beta.slug]),
    `no header → ${show(missing)} (want 400 ORG_SLUG_REQUIRED), listed slug → ${chosen.status} /me organizations=${JSON.stringify(meSlugs)}`,
  );
}
