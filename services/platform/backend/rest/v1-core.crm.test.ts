// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createCoreRoutes } from './v1-core.ts';

/**
 * The contacts and products doors validate what the API reference promises
 * they validate. The regressions under test: an unknown key was dropped in
 * silence (a body whose every key was misspelled minted a nameless,
 * mailless row no query could find again, and `expectedUpdatedAt` on a
 * product was ignored); a number beyond 2^53 − 1 was rounded by the parser
 * and stored with a 201 (an `externalId` filed under a neighbouring id);
 * and no route told a caller its own organization slug.
 */

vi.mock('../domains/contacts/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/contacts/service.ts')>();
  return {
    ...actual,
    createContact: vi.fn(async () => 'c-new'),
    updateContact: vi.fn(async () => undefined),
    getContact: vi.fn(async () => ({
      id: 'c-1',
      organizationId: 'org-1',
      lifecycleStatus: null,
      updatedAt: 1_700_000_000_000,
    })),
  };
});

vi.mock('../domains/products/service.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../domains/products/service.ts')>();
  return {
    ...actual,
    createProduct: vi.fn(async () => 'p-new'),
    updateProduct: vi.fn(async () => undefined),
    getProduct: vi.fn(async () => ({ id: 'p-1', organizationId: 'org-1' })),
  };
});

const { createContact, updateContact } =
  await import('../domains/contacts/service.ts');
const { updateProduct } = await import('../domains/products/service.ts');

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM "member" m')) {
      return Promise.resolve([
        { organizationId: 'org-1', role: 'admin', name: 'Acme', slug: 'acme' },
        {
          organizationId: 'org-2',
          role: 'member',
          name: 'Beta',
          slug: 'beta',
        },
        {
          organizationId: 'org-3',
          role: 'disabled',
          name: 'Gone',
          slug: 'gone',
        },
      ]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, {
    unsafe: (t: string) => t,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  }) as unknown as Sql;
}

function mount() {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createCoreRoutes({ sql: fakeSql() }));
  return app;
}

const send = (route: string, method: string, body: unknown) =>
  mount().request(`http://localhost${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /me', () => {
  it('names the resolved organization, its slug and every live membership', async () => {
    const res = await mount().request('http://localhost/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 'user-1', email: 'user@example.com' },
      organization: { id: 'org-1', slug: 'acme', role: 'admin' },
      organizations: [
        { id: 'org-1', slug: 'acme', name: 'Acme', role: 'admin' },
        { id: 'org-2', slug: 'beta', name: 'Beta', role: 'member' },
      ],
    });
  });
});

describe('contact bodies', () => {
  it('refuses an unknown key instead of dropping it', async () => {
    const res = await send('/contacts', 'POST', {
      firstName: 'Ada',
      lastName: 'L',
      emailAddress: 'ada@example.com',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      data: { issues: { path: string }[] };
    };
    expect(body.code).toBe('INVALID_BODY');
    expect(body.data.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['firstName']),
    );
    expect(vi.mocked(createContact)).not.toHaveBeenCalled();
  });

  it('refuses a create with nothing to file the contact under', async () => {
    const res = await send('/contacts', 'POST', { tags: ['vip'] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
  });

  it('refuses an externalId beyond the safe integer range, keeps one inside it as text', async () => {
    const tooBig = await send('/contacts', 'POST', {
      name: 'Big',
      // 2^53: past Number.MAX_SAFE_INTEGER, and exactly representable.
      externalId: 2 ** 53,
    });
    expect(tooBig.status).toBe(400);
    expect(await tooBig.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'externalId' })] },
    });

    const ok = await send('/contacts', 'POST', {
      name: 'Fine',
      externalId: 4711,
    });
    expect(ok.status).toBe(201);
    expect(vi.mocked(createContact).mock.calls.at(-1)?.[2]).toMatchObject({
      externalId: '4711',
    });
  });

  it('refuses a malformed email and an over-long name by field', async () => {
    const res = await send('/contacts', 'POST', {
      name: 'x'.repeat(301),
      email: 'not-an-email',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      data: { issues: { path: string }[] };
    };
    expect(body.data.issues.map((issue) => issue.path).sort()).toEqual([
      'email',
      'name',
    ]);
  });

  it('keeps the strict rule on PATCH and bulk', async () => {
    const patched = await send('/contacts/c-1', 'PATCH', {
      nmae: 'typo',
    });
    expect(patched.status).toBe(400);
    expect(vi.mocked(updateContact)).not.toHaveBeenCalled();

    const bulk = await send('/contacts/bulk', 'POST', {
      contacts: [{ email: 'a@example.com', colour: 'blue' }],
    });
    expect(bulk.status).toBe(400);
    expect(await bulk.json()).toMatchObject({ code: 'INVALID_BODY' });
  });
});

describe('product bodies', () => {
  it('refuses an unknown key and a status outside the vocabulary', async () => {
    const unknown = await send('/products', 'POST', {
      name: 'Widget',
      pricee: 5,
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 'INVALID_BODY' });

    const status = await send('/products', 'POST', {
      name: 'Widget',
      status: 'bogus',
    });
    expect(status.status).toBe(400);
  });

  it('refuses stock and price beyond the safe range instead of rounding them', async () => {
    for (const field of ['stock', 'price']) {
      const res = await send('/products', 'POST', {
        name: 'Widget',
        [field]: 2 ** 53,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        data: { issues: [expect.objectContaining({ path: field })] },
      });
    }
  });

  it('carries expectedUpdatedAt into the update as the precondition', async () => {
    const res = await send('/products/p-1', 'PATCH', {
      description: 'guarded',
      expectedUpdatedAt: 1_700_000_000_000,
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateProduct).mock.calls.at(-1)?.[3]).toMatchObject({
      description: 'guarded',
      expectedUpdatedAt: 1_700_000_000_000,
    });
  });
});
