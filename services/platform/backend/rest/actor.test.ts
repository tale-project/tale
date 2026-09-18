import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  actedBy,
  actorBodySchema,
  mayActAs,
  resolveActor,
  resolveRequestActor,
} from './actor.ts';
import { type RestEnv, RestRefusal } from './shared.ts';

interface Captured {
  text: string;
  values: unknown[];
}

type MemberRow = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: string;
};

/** A tagged-template Sql double answering the two reads the module makes:
 * the member lookup by e-mail and the competence register. */
function fakeSql(opts: {
  members?: MemberRow[];
  capability?: { expiresAt: number | null; revokedAt: number | null };
}): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "user" u JOIN "member" m')) {
      return Promise.resolve(opts.members ?? []);
    }
    if (text.includes('FROM app.competence_records')) {
      return Promise.resolve(opts.capability ? [opts.capability] : []);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => ({ unsafe: text }),
  });
  return { sql: sql as unknown as Sql, queries };
}

const verified: MemberRow = {
  id: 'user-9',
  email: 'reginald@example.com',
  emailVerified: true,
  role: 'member',
};

async function refusal(promise: Promise<unknown>): Promise<RestRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RestRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('actorBodySchema', () => {
  it('lower-cases and trims the e-mail and refuses unknown keys', () => {
    expect(actorBodySchema.parse({ email: '  Reginald@Example.COM ' })).toEqual(
      { email: 'reginald@example.com' },
    );
    expect(actorBodySchema.safeParse({ email: 'not-an-email' }).success).toBe(
      false,
    );
    expect(
      actorBodySchema.safeParse({ email: 'a@b.co', role: 'admin' }).success,
    ).toBe(false);
  });
});

describe('resolveActor', () => {
  it('answers the one verified, active member the address names', async () => {
    const { sql, queries } = fakeSql({ members: [verified] });
    await expect(
      resolveActor(sql, 'org-1', { email: 'reginald@example.com' }),
    ).resolves.toEqual({
      userId: 'user-9',
      email: 'reginald@example.com',
      role: 'member',
    });
    const lookup = queries.find((q) => q.text.includes('FROM "user" u'));
    expect(lookup?.values).toEqual(['org-1', 'reginald@example.com']);
    expect(lookup?.text).toContain('LIMIT 2');
  });

  it('refuses an address no member carries as 404 ACTOR_NOT_FOUND', async () => {
    const { sql } = fakeSql({ members: [] });
    const error = await refusal(
      resolveActor(sql, 'org-1', { email: 'nobody@example.com' }),
    );
    expect(error.status).toBe(404);
    expect(error.code).toBe('ACTOR_NOT_FOUND');
  });

  it('refuses two members on one address as 409 ACTOR_AMBIGUOUS', async () => {
    const { sql } = fakeSql({
      members: [verified, { ...verified, id: 'user-10' }],
    });
    const error = await refusal(
      resolveActor(sql, 'org-1', { email: 'reginald@example.com' }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('ACTOR_AMBIGUOUS');
  });

  it('refuses an unverified address and a disabled membership as 403', async () => {
    const unverified = await refusal(
      resolveActor(
        fakeSql({ members: [{ ...verified, emailVerified: false }] }).sql,
        'org-1',
        {
          email: 'reginald@example.com',
        },
      ),
    );
    expect(unverified.status).toBe(403);
    expect(unverified.code).toBe('ACTOR_UNVERIFIED');
    const disabled = await refusal(
      resolveActor(
        fakeSql({ members: [{ ...verified, role: 'disabled' }] }).sql,
        'org-1',
        {
          email: 'reginald@example.com',
        },
      ),
    );
    expect(disabled.status).toBe(403);
    expect(disabled.code).toBe('ACTOR_DISABLED');
  });

  it('judges the pin before the new holder’s state: a rebound to an unverified account is still ACTOR_REBOUND', async () => {
    const error = await refusal(
      resolveActor(
        fakeSql({ members: [{ ...verified, emailVerified: false }] }).sql,
        'org-1',
        { email: 'reginald@example.com', userId: 'user-old' },
      ),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('ACTOR_REBOUND');
  });

  it('refuses an address that moved to another member than the pinned id as 409 ACTOR_REBOUND', async () => {
    const { sql } = fakeSql({ members: [verified] });
    const error = await refusal(
      resolveActor(sql, 'org-1', {
        email: 'reginald@example.com',
        userId: 'user-old',
      }),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe('ACTOR_REBOUND');
    await expect(
      resolveActor(sql, 'org-1', {
        email: 'reginald@example.com',
        userId: 'user-9',
      }),
    ).resolves.toMatchObject({ userId: 'user-9' });
  });
});

describe('mayActAs', () => {
  const caller = { organizationId: 'org-1', userId: 'user-1', role: 'member' };

  it('is true for an owner or admin by role, without reading the register', async () => {
    for (const role of ['owner', 'admin', 'Admin']) {
      const { sql, queries } = fakeSql({});
      await expect(mayActAs(sql, { ...caller, role }, 1)).resolves.toBe(true);
      expect(queries).toEqual([]);
    }
  });

  it('is false for a disabled membership whatever the register says', async () => {
    const { sql, queries } = fakeSql({
      capability: { expiresAt: null, revokedAt: null },
    });
    await expect(
      mayActAs(sql, { ...caller, role: 'disabled' }, 1),
    ).resolves.toBe(false);
    expect(queries).toEqual([]);
  });

  it('follows a live tale:rest.act-as grant for any other member', async () => {
    const granted = fakeSql({
      capability: { expiresAt: null, revokedAt: null },
    });
    await expect(mayActAs(granted.sql, caller, 1_000)).resolves.toBe(true);
    expect(
      granted.queries.find((q) =>
        q.text.includes('FROM app.competence_records'),
      )?.values,
    ).toContain('tale:rest.act-as');
    const none = fakeSql({});
    await expect(mayActAs(none.sql, caller, 1_000)).resolves.toBe(false);
  });
});

describe('resolveRequestActor', () => {
  function context(role: string) {
    const app = new Hono<RestEnv>();
    let captured: Parameters<typeof resolveRequestActor>[1] | undefined;
    app.use(async (c, next) => {
      c.set('userId', 'user-1');
      c.set('userEmail', 'key@example.com');
      c.set('organizationId', 'org-1');
      c.set('orgSlug', 'acme');
      c.set('role', role);
      c.set('orgExplicit', true);
      c.set('clientIp', '203.0.113.9');
      captured = c;
      return next();
    });
    app.get('/', (c) => c.json({}));
    return async () => {
      await app.request('http://localhost/');
      if (captured === undefined) throw new Error('no context');
      return captured;
    };
  }

  it('answers null when no actor is named, whatever the role', async () => {
    const c = await context('member')();
    const { sql, queries } = fakeSql({});
    await expect(resolveRequestActor(sql, c, undefined)).resolves.toBeNull();
    expect(queries).toEqual([]);
    expect(actedBy(null, c)).toBe('api-key:user-1');
  });

  it('refuses a member without the capability before any member row is read', async () => {
    const c = await context('member')();
    const { sql, queries } = fakeSql({ members: [verified] });
    const error = await refusal(
      resolveRequestActor(sql, c, { email: 'reginald@example.com' }),
    );
    expect(error.status).toBe(403);
    expect(error.code).toBe('ROLE_FORBIDDEN');
    expect(queries.some((q) => q.text.includes('FROM "user" u'))).toBe(false);
  });

  it('resolves for an admin and names the person, not the key', async () => {
    const c = await context('admin')();
    const { sql } = fakeSql({ members: [verified] });
    const actor = await resolveRequestActor(sql, c, {
      email: 'Reginald@example.com'.toLowerCase(),
    });
    expect(actor).toEqual({
      userId: 'user-9',
      email: 'reginald@example.com',
      role: 'member',
    });
    expect(actedBy(actor, c)).toBe('user-9');
  });
});
