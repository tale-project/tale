// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    bulkCreateContacts: vi.fn(async () => ({
      success: 0,
      failed: 0,
      created: [],
      errors: [],
    })),
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

const { bulkCreateContacts, createContact, updateContact } =
  await import('../domains/contacts/service.ts');
const { createProduct, updateProduct } =
  await import('../domains/products/service.ts');

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

/** The 400 envelope's issues for a body the route refuses. */
async function refused(
  route: string,
  method: string,
  body: unknown,
): Promise<{ path: string; message: string }[]> {
  const res = await send(route, method, body);
  expect(res.status).toBe(400);
  const payload = (await res.json()) as {
    code: string;
    data: { issues: { path: string; message: string }[] };
  };
  expect(payload.code).toBe('INVALID_BODY');
  return payload.data.issues;
}

/** `levels` nested objects under one key: `nest(2)` is `{a: {a: {}}}`. */
function nest(levels: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let index = 0; index < levels; index += 1) value = { a: value };
  return value;
}

function keyed(count: number): Record<string, number> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [`k${index}`, index]),
  );
}

/**
 * The one clearing rule. The regression under test: `null` was refused on
 * every optional field, while `""` on PATCH was a silent no-op on `phone`
 * and `email`, cleared `externalId` and was stored as `""` on `notes` — so
 * an integrator erasing a phone got a 200 and the stale number stayed.
 */
describe('the clearing rule: null clears, a blank on PATCH reads as null', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes null through to the update for every optional contact field', async () => {
    const res = await send('/contacts/c-1', 'PATCH', {
      phone: null,
      email: null,
      address: null,
      metadata: null,
      tags: null,
      notes: null,
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateContact).mock.calls.at(-1)?.[3]).toMatchObject({
      phone: null,
      email: null,
      address: null,
      metadata: null,
      tags: null,
      notes: null,
    });
  });

  it('reads a blank string on PATCH as null on every clearable field', async () => {
    const res = await send('/contacts/c-1', 'PATCH', {
      phone: '',
      email: '  ',
      notes: '   ',
      metadata: '',
      externalId: '',
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateContact).mock.calls.at(-1)?.[3]).toMatchObject({
      phone: null,
      email: null,
      notes: null,
      metadata: null,
      externalId: null,
    });
  });

  it('clears product fields sent as null or blank, never a blank inside metadata', async () => {
    const res = await send('/products/p-1', 'PATCH', {
      price: null,
      currency: '',
      status: null,
      metadata: { note: '' },
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateProduct).mock.calls.at(-1)?.[3]).toEqual({
      price: null,
      currency: null,
      status: null,
      metadata: { note: '' },
    });
  });

  it('refuses a blank required field on PATCH by name instead of clearing it', async () => {
    expect(await refused('/products/p-1', 'PATCH', { name: '   ' })).toEqual([
      { path: 'name', message: 'must not be blank' },
    ]);
    expect(vi.mocked(updateProduct)).not.toHaveBeenCalled();
  });

  it('drops a blank optional field on create and on every bulk row', async () => {
    const created = await send('/contacts', 'POST', {
      name: 'Ada',
      phone: '',
      notes: '  ',
      email: '',
    });
    expect(created.status).toBe(201);
    const input = vi.mocked(createContact).mock.calls.at(-1)?.[2];
    expect(input).toMatchObject({ name: 'Ada', source: 'api_import' });
    expect(input).not.toHaveProperty('phone');
    expect(input).not.toHaveProperty('notes');
    expect(input).not.toHaveProperty('email');

    const bulk = await send('/contacts/bulk', 'POST', {
      contacts: [{ email: 'a@example.com', phone: '' }],
    });
    expect(bulk.status).toBe(201);
    expect(vi.mocked(bulkCreateContacts).mock.calls.at(-1)?.[2]).toEqual([
      { email: 'a@example.com' },
    ]);
  });

  it('refuses a blank product name on create and names a missing one as required', async () => {
    expect(await refused('/products', 'POST', { name: ' ' })).toEqual([
      { path: 'name', message: 'must not be blank' },
    ]);
    expect(await refused('/products', 'POST', { category: 'x' })).toEqual([
      { path: 'name', message: 'is required' },
    ]);
    expect(vi.mocked(createProduct)).not.toHaveBeenCalled();
  });
});

/**
 * Normalization is one rule for every free-text field, and the two typed
 * product fields are typed. The regressions under test: `category` kept
 * its padding while `name` lost it; `currency` accepted `ZZZ`, `123` and
 * `$`; `imageUrl` accepted `javascript:alert(1)`; a 300-character email
 * local part passed.
 */
describe('normalization and the typed product fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trims free text, stores the email lowercase and the currency uppercase', async () => {
    const contact = await send('/contacts', 'POST', {
      name: '  Ada  Lovelace  ',
      email: ' Ada.Lovelace+TAG@Example.COM ',
      phone: ' +1 555 ',
      tags: [' vip '],
    });
    expect(contact.status).toBe(201);
    expect(vi.mocked(createContact).mock.calls.at(-1)?.[2]).toMatchObject({
      name: 'Ada  Lovelace',
      email: 'ada.lovelace+tag@example.com',
      phone: '+1 555',
      tags: ['vip'],
    });

    const product = await send('/products', 'POST', {
      name: '  Widget ',
      category: '  Gadgets  ',
      currency: 'usd',
      imageUrl: ' https://cdn.example/w.png ',
    });
    expect(product.status).toBe(201);
    expect(vi.mocked(createProduct).mock.calls.at(-1)?.[2]).toEqual({
      name: 'Widget',
      category: 'Gadgets',
      currency: 'USD',
      imageUrl: 'https://cdn.example/w.png',
    });
  });

  it('caps the email local part at 64 characters', async () => {
    const ok = await send('/contacts', 'POST', {
      email: `${'x'.repeat(64)}@example.invalid`,
    });
    expect(ok.status).toBe(201);
    expect(
      await refused('/contacts', 'POST', {
        email: `${'x'.repeat(65)}@example.invalid`,
      }),
    ).toEqual([{ path: 'email', message: expect.stringContaining('64') }]);
  });

  it.each(['ZZZ', '123', '$', 'US', 'usdd'])(
    'refuses currency %j as not an ISO 4217 code',
    async (currency) => {
      const issues = await refused('/products', 'POST', {
        name: 'Widget',
        currency,
      });
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.path === 'currency')).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'not a url at all',
    'ftp://cdn.example/w.png',
    '//cdn.example/w.png',
  ])('refuses imageUrl %j as not an absolute http(s) URL', async (imageUrl) => {
    expect(
      await refused('/products', 'POST', { name: 'Widget', imageUrl }),
    ).toEqual([
      { path: 'imageUrl', message: 'must be an absolute http(s) URL' },
    ]);
  });
});

/**
 * The free-form object fields are bounded. The regression under test:
 * `metadata` and `address` were `record<string, unknown>` with no cap, so
 * a 5 MB blob and a hundred-level nesting were stored with a 201.
 */
describe('free-form object bounds', () => {
  const baseFor = (route: string, method: string): Record<string, unknown> => {
    if (method !== 'POST') return {};
    if (route === '/products') return { name: 'Widget' };
    if (route === '/documents') return { title: 'Doc' };
    return { name: 'Ada' };
  };

  it.each([
    ['/contacts', 'POST', 'metadata'],
    ['/contacts', 'POST', 'address'],
    ['/contacts/c-1', 'PATCH', 'address'],
    ['/products', 'POST', 'metadata'],
    ['/products/p-1', 'PATCH', 'metadata'],
    ['/documents', 'POST', 'metadata'],
    ['/documents/d-1', 'PATCH', 'metadata'],
  ])(
    '%s %s refuses a %s past the depth, key and byte bounds, by path',
    async (route, method, field) => {
      const base = baseFor(route, method);
      expect(
        await refused(route, method, { ...base, [field]: nest(9) }),
      ).toEqual([
        {
          path: `${field}.${Array.from({ length: 9 }, () => 'a').join('.')}`,
          message: 'is nested deeper than 8 levels',
        },
      ]);
      expect(
        await refused(route, method, { ...base, [field]: keyed(501) }),
      ).toEqual([
        { path: field, message: 'holds more than 500 keys in total' },
      ]);
      expect(
        await refused(route, method, {
          ...base,
          [field]: { blob: 'x'.repeat(65_536) },
        }),
      ).toEqual([
        {
          path: field,
          message: expect.stringContaining('exceeds 64 KiB of JSON'),
        },
      ]);
    },
  );

  it('accepts a value inside every bound', async () => {
    const res = await send('/contacts', 'POST', {
      name: 'Ada',
      metadata: nest(8),
      address: keyed(500),
    });
    expect(res.status).toBe(201);
  });
});
