// @vitest-environment node

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  findNulByte,
  formatKeysetCursor,
  invalidBodyResponse,
  INVALID_JSON,
  loadRestProject,
  mintCursorFor,
  PAGE_QUERY,
  pageLimit,
  parseKeysetCursor,
  queryFilter,
  readJsonBody,
  readOptionalJsonBody,
  readPageLimit,
  readQuery,
  resetCursorKeyForTests,
  type RestEnv,
  verifyCursorFor,
} from './shared.ts';

describe('REST project access', () => {
  const auth = {
    organizationId: 'org-1',
    userId: 'user-1',
    role: 'member',
    teamIds: ['team-1'],
  };
  const project = {
    id: 'project-1',
    organizationId: 'org-1',
    teamId: 'team-1',
    sharedWithTeamIds: [],
    archivedAt: null,
  };
  const database = (rows: unknown[], error?: Error) =>
    Object.assign(
      () => (error ? Promise.reject(error) : Promise.resolve(rows)),
      { unsafe: (text: string) => text },
    ) as unknown as Sql;

  it('keeps missing, foreign and invisible projects opaque', async () => {
    for (const rows of [
      [],
      [{ ...project, organizationId: 'other-org' }],
      [{ ...project, teamId: 'other-team' }],
    ]) {
      await expect(
        loadRestProject(database(rows), auth, project.id),
      ).rejects.toMatchObject({ status: 404, message: 'Project not found' });
    }
  });

  it('allows member collaboration but refuses editorial changes', async () => {
    const sql = database([project]);
    await expect(
      loadRestProject(sql, auth, project.id, { active: true }),
    ).resolves.toEqual(project);
    await expect(
      loadRestProject(sql, auth, project.id, { write: true }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      loadRestProject(sql, { ...auth, role: 'editor' }, project.id, {
        write: true,
      }),
    ).resolves.toEqual(project);
  });

  it('permits archived reads but refuses all active-project mutations', async () => {
    const archived = { ...project, archivedAt: 123 };
    const sql = database([archived]);
    await expect(loadRestProject(sql, auth, project.id)).resolves.toEqual(
      archived,
    );
    for (const options of [{ active: true }, { write: true }]) {
      await expect(
        loadRestProject(sql, { ...auth, role: 'admin' }, project.id, options),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it('preserves database failures as outages rather than missing resources', async () => {
    const outage = new Error('database unavailable');
    await expect(
      loadRestProject(database([], outage), auth, project.id),
    ).rejects.toBe(outage);
  });
});

/**
 * The one cursor codec every keyset-paginated /api/v1 list shares, and the
 * page-size clamp: a consumer passes `continueCursor` straight back as
 * `cursor`, and no `limit` a client can send turns into a Postgres error
 * (negative LIMIT) or a dead page (LIMIT 0 answering nothing forever).
 */

describe('keyset cursor codec', () => {
  it("round-trips the previous page's last row", () => {
    const token = formatKeysetCursor(1_725_000_000_000, 'row-42');
    expect(token).toBe('1725000000000:row-42');
    expect(parseKeysetCursor(token)).toEqual({
      at: 1_725_000_000_000,
      id: 'row-42',
    });
  });

  it('keeps an id that itself contains the separator intact', () => {
    expect(parseKeysetCursor('17:a:b:c')).toEqual({ at: 17, id: 'a:b:c' });
  });

  it('reads an absent or empty cursor as the first page', () => {
    expect(parseKeysetCursor(undefined)).toBeNull();
    expect(parseKeysetCursor(null)).toBeNull();
    expect(parseKeysetCursor('')).toBeNull();
  });

  it('reads an unparseable token as the first page, never a crash', () => {
    for (const garbage of [
      'nope',
      ':row',
      '17:',
      'NaN:row',
      '{"updatedAt":1,"id":"x"}',
    ]) {
      expect(parseKeysetCursor(garbage)).toBeNull();
    }
  });
});

describe('pageLimit', () => {
  it('honours a sane value and defaults when absent', () => {
    expect(pageLimit('40', { fallback: 25, max: 200 })).toBe(40);
    expect(pageLimit(undefined, { fallback: 25, max: 200 })).toBe(25);
  });

  it('floors at one row and caps at the family maximum', () => {
    expect(pageLimit('0', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('-5', { fallback: 25, max: 200 })).toBe(1);
    expect(pageLimit('1000', { fallback: 25, max: 200 })).toBe(200);
  });

  it('falls back on non-numeric input and truncates fractions', () => {
    expect(pageLimit('abc', { fallback: 25, max: 200 })).toBe(25);
    expect(pageLimit('2.9', { fallback: 25, max: 200 })).toBe(2);
  });

  it('reads a blank limit as an absent one, never as a one-row page', () => {
    // `Number('')` is 0 — floored to 1, a bare `?limit=` used to answer
    // single-row pages with nothing telling the caller why.
    expect(pageLimit('', { fallback: 25, max: 200 })).toBe(25);
    expect(pageLimit('   ', { fallback: 25, max: 200 })).toBe(25);
  });
});

/**
 * Cursors are signed for the list and organization that answered them:
 * the API reference promises a cursor the list never answered is refused
 * rather than read as the first page, and a raw `<ts>:<id>` position any
 * client could synthesise (a future stamp reads as "past the newest row")
 * silently restarted a worker's walk at page one.
 */
describe('signed cursors', () => {
  beforeEach(() => {
    resetCursorKeyForTests();
  });

  it('round-trips a position for the list and organization that minted it', () => {
    const token = mintCursorFor('org-1', 'contacts', '1725000000000:row-42');
    expect(token.startsWith('1725000000000:row-42.')).toBe(true);
    expect(verifyCursorFor('org-1', 'contacts', token)).toBe(
      '1725000000000:row-42',
    );
  });

  it('refuses the same token from another list or another organization', () => {
    const token = mintCursorFor('org-1', 'contacts', '1725000000000:row-42');
    expect(verifyCursorFor('org-1', 'products', token)).toBeNull();
    expect(verifyCursorFor('org-2', 'contacts', token)).toBeNull();
  });

  it('refuses a tampered position, a tampered tag and an unsigned position', () => {
    const token = mintCursorFor('org-1', 'contacts', '1725000000000:row-42');
    const dot = token.lastIndexOf('.');
    const tag = token.slice(dot + 1);
    expect(
      verifyCursorFor('org-1', 'contacts', `1725000000000:row-43.${tag}`),
    ).toBeNull();
    expect(
      verifyCursorFor('org-1', 'contacts', `${token.slice(0, -1)}x`),
    ).toBeNull();
    for (const bare of ['1725000000000:row-42', '.', 'abc.', '.abc', '']) {
      expect(verifyCursorFor('org-1', 'contacts', bare)).toBeNull();
    }
  });

  it('keeps a position that itself contains dots intact', () => {
    const token = mintCursorFor('org-1', 'files:p-1', '17:a.b.c');
    expect(verifyCursorFor('org-1', 'files:p-1', token)).toBe('17:a.b.c');
  });

  it('derives its key from the deployment secret, so replicas agree', () => {
    const before = process.env.INSTANCE_SECRET;
    try {
      process.env.INSTANCE_SECRET = 'secret-a';
      resetCursorKeyForTests();
      const token = mintCursorFor('org-1', 'contacts', '1:x');
      resetCursorKeyForTests();
      expect(mintCursorFor('org-1', 'contacts', '1:x')).toBe(token);
      process.env.INSTANCE_SECRET = 'secret-b';
      resetCursorKeyForTests();
      expect(verifyCursorFor('org-1', 'contacts', token)).toBeNull();
    } finally {
      if (before === undefined) delete process.env.INSTANCE_SECRET;
      else process.env.INSTANCE_SECRET = before;
      resetCursorKeyForTests();
    }
  });
});

/**
 * A U+0000 anywhere in a JSON body can never be stored (Postgres `22021`)
 * — it is refused with the documented 400, naming where it sits, instead
 * of reaching the driver as a text/plain 500.
 */
describe('findNulByte', () => {
  it('finds a NUL in a value, an array element, a nested field and a key', () => {
    expect(findNulByte({ name: 'a\0b' })).toBe('name');
    expect(findNulByte({ tags: ['ok', 'x\0'] })).toBe('tags.1');
    expect(findNulByte({ address: { city: 'a\0' } })).toBe('address.city');
    expect(findNulByte({ 'we\0ird': 1 })).toBe('we\0ird');
    expect(findNulByte(['a', { b: ['c', 'd\0'] }])).toBe('1.b.1');
  });

  it('answers null for a clean body of any shape', () => {
    for (const clean of [
      {},
      [],
      'text',
      42,
      null,
      { name: 'a\u0001b', nested: { list: ['x', 'y'] } },
    ]) {
      expect(findNulByte(clean)).toBeNull();
    }
  });

  it('walks a deeply nested body without recursing', () => {
    let deep: unknown = 'leaf\0';
    for (let depth = 0; depth < 50_000; depth += 1) deep = [deep];
    expect(findNulByte(deep)).toMatch(/^0(\.0){49999}$/);
  });
});

/**
 * The keyset codec only ever writes a whole epoch-millisecond count. A
 * fraction, an exponent or a count beyond the bigint column used to pass
 * `Number.isFinite` and reach Postgres as a cast error — a 500 where the
 * door had just promised a 400 for a cursor it never answered.
 */
describe('parseKeysetCursor — timestamps the column cannot hold', () => {
  it.each([
    '1.5:p-2',
    '100000000000000000000:p-2',
    '1e100:p-2',
    '-5:p-2',
    '0x10:p-2',
    ' 7:p-2',
  ])('reads %s as no cursor', (token) => {
    expect(parseKeysetCursor(token)).toBeNull();
  });

  it('keeps a whole epoch-millisecond count', () => {
    expect(parseKeysetCursor('1699999999998:p-2')).toEqual({
      at: 1_699_999_999_998,
      id: 'p-2',
    });
  });
});

/**
 * The query string is one strict object: a parameter the route does not
 * take, or one given twice, is refused — a mistyped filter used to answer
 * the whole unfiltered list, and a fractional `limit` a one-row page.
 */
describe('readQuery / readPageLimit', () => {
  function probe() {
    const app = new Hono<RestEnv>();
    app.get('/list', (c) => {
      const query = readQuery(c, {
        ...PAGE_QUERY,
        status: z.enum(['active', 'archived']).optional(),
        folderId: queryFilter().optional(),
      });
      if (query instanceof Response) return query;
      const limit = readPageLimit(c, { fallback: 25, max: 100 });
      if (limit instanceof Response) return limit;
      return c.json({ query, limit });
    });
    return app;
  }

  it('answers the declared parameters and clamps a whole-number limit', async () => {
    const res = await probe().request('/list?status=active&limit=1000');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: { status: 'active', limit: '1000' },
      limit: 100,
    });
  });

  it('refuses a parameter the route does not take, naming it', async () => {
    const res = await probe().request('/list?statuss=active');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid query: "statuss" is not a parameter this route takes',
      code: 'INVALID_QUERY',
      data: {
        issues: [
          { path: 'statuss', message: 'is not a parameter this route takes' },
        ],
      },
    });
  });

  it('refuses a parameter given twice rather than reading the first', async () => {
    const res = await probe().request('/list?limit=1&limit=100');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'limit', message: 'is given more than once' }] },
    });
  });

  it('refuses a blank named filter instead of matching nothing', async () => {
    const res = await probe().request('/list?folderId=%20');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'folderId', message: 'must not be blank' }] },
    });
  });

  it('refuses a blank limit or cursor like any blank parameter, never as the first page', async () => {
    // A blank `cursor` is exactly what the last page's empty
    // `continueCursor` hands a naive pager: read as the first page it
    // walked the list from the start forever.
    for (const query of ['limit=', 'cursor=', 'cursor=%20%20', 'limit=%20']) {
      const res = await probe().request(`/list?${query}`);
      expect(res.status).toBe(400);
      const name = query.split('=')[0];
      expect(await res.json()).toEqual({
        error: `invalid query: "${name}" must not be blank`,
        code: 'INVALID_QUERY',
        data: { issues: [{ path: name, message: 'must not be blank' }] },
      });
    }
  });

  it('refuses a fractional or non-numeric limit', async () => {
    for (const bad of ['1.5', '1e2', 'abc']) {
      const res = await probe().request(`/list?limit=${bad}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
    }
  });
});

/**
 * Bodies are read strictly: not UTF-8 is a 400 naming the problem (the
 * Fetch decoder used to repair it with U+FFFD and the repaired text was
 * stored), and a body over the cap is a 413 refused before it is read
 * when the length is declared, and at the first chunk past it otherwise.
 */
describe('readJsonBody', () => {
  function probe() {
    const app = new Hono<RestEnv>();
    app.onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json(
          { error: err.message, code: 'BODY_TOO_LARGE' },
          err.status,
        );
      }
      throw err;
    });
    app.post('/echo', async (c) => {
      const body = z
        .object({ text: z.string() })
        .strict()
        .safeParse(await readJsonBody(c, { maxBytes: 64 }));
      return body.success
        ? c.json(body.data)
        : invalidBodyResponse(c, body.error);
    });
    app.post('/maybe', async (c) =>
      c.json({ invalid: (await readOptionalJsonBody(c)) === INVALID_JSON }),
    );
    return app;
  }

  it('refuses a body that is not UTF-8 with the field-level envelope', async () => {
    const res = await probe().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array([
        0x7b, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22,
        0x7d,
      ]),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid body: The body is not valid UTF-8',
      code: 'INVALID_BODY',
      data: { issues: [{ path: '', message: 'The body is not valid UTF-8' }] },
    });
    const optional = await probe().request('/maybe', {
      method: 'POST',
      body: new Uint8Array([0xc3]),
    });
    expect(optional.status).toBe(200);
    expect(await optional.json()).toEqual({ invalid: true });
  });

  it('keeps valid UTF-8 exactly, multi-byte text included', async () => {
    const res = await probe().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Zürich — 東京' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Zürich — 東京' });
  });

  it('refuses a declared oversize body before reading it, and a streamed one at the cap', async () => {
    const declared = await probe().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '5000' },
      body: '{"text":"x"}',
    });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ code: 'BODY_TOO_LARGE' });
    const streamed = await probe().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'y'.repeat(200) }),
    });
    expect(streamed.status).toBe(413);
  });
});

describe('readJsonBody — numbers the parser cannot carry', () => {
  function probe() {
    const app = new Hono<RestEnv>();
    app.post('/echo', async (c) => {
      const body = z
        .object({ externalId: z.union([z.string(), z.number()]) })
        .strict()
        .safeParse(await readJsonBody(c));
      return body.success
        ? c.json(body.data)
        : invalidBodyResponse(c, body.error);
    });
    return app;
  }

  it('refuses a whole number beyond 2^53 − 1 instead of rounding it', async () => {
    const res = await probe().request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"externalId": 9007199254740993}',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: {
        issues: [
          {
            path: 'externalId',
            message: expect.stringContaining('beyond 2^53 − 1'),
          },
        ],
      },
    });
  });

  it('keeps exact integers, fractions and the same id as a string', async () => {
    for (const [body, expected] of [
      ['{"externalId": 9007199254740991}', 9007199254740991],
      ['{"externalId": 1.5}', 1.5],
      ['{"externalId": "9007199254740993"}', '9007199254740993'],
    ] as const) {
      const res = await probe().request('/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ externalId: expected });
    }
  });
});
