// The secret routes over the real manager: the port of the parts of the old
// app's `test_secrets.py` that go through HTTP. What the vault does to fields,
// titles and previews is tested in `vault.test.ts`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  metaSchema,
  secretSchema,
  secretSummarySchema,
} from '../../../lib/api/schemas.ts';
import { expectError, expectJson } from '../../testing/api-client.ts';
import { addProxy, createFlow, createSession } from '../../testing/api-flow.ts';
import type { Flow } from '../../testing/api-flow.ts';

const summaries = z.array(secretSummarySchema);

const LOGIN = {
  kind: 'credentials',
  title: 'Shop login',
  fields: [
    { label: 'Website', value: 'https://shop.example' },
    { label: 'Username', value: 'yannick@example.com' },
    { label: 'Password', value: 'hunter2' },
  ],
};
const CARD = {
  kind: 'card',
  title: 'Visa',
  fields: [
    { label: 'Cardholder', value: 'Y. Monney' },
    { label: 'Card number', value: '4242 4242 4242 4242' },
    { label: 'Expiry', value: '12/30' },
    { label: 'CVC', value: '123' },
  ],
};

let flow: Flow;
beforeEach(() => {
  flow = createFlow();
});
afterEach(() => flow.close());

async function create(body: Record<string, unknown>) {
  const response = await flow.client.post('/api/secrets', body);
  return expectJson(response, 201, secretSchema);
}

async function titles(query: Record<string, string | number | boolean> = {}) {
  const response = await flow.client.get('/api/secrets', { query });
  return (await expectJson(response, 200, summaries)).map((s) => s.title);
}

describe('the meta of the secrets', () => {
  it('lists the kinds and counts the secrets', async () => {
    const before = await expectJson(
      await flow.client.get('/api/meta'),
      200,
      metaSchema,
    );
    expect(before.secretKinds.map((kind) => kind.key)).toEqual([
      'personal',
      'credentials',
      'card',
      'note',
    ]);
    const password = before.secretKinds[1]?.fields.find(
      (field) => field.label === 'Password',
    );
    expect(password).toEqual({
      label: 'Password',
      hidden: true,
      multiline: false,
    });
    expect(before.counts.secrets).toBe(0);

    await create(LOGIN);

    const after = await expectJson(
      await flow.client.get('/api/meta'),
      200,
      metaSchema,
    );
    expect(after.counts.secrets).toBe(1);
  });
});

describe('a secret', () => {
  it('is created, read, updated and deleted', async () => {
    const created = await create(LOGIN);
    expect([created.kind, created.title, created.session]).toEqual([
      'credentials',
      'Shop login',
      null,
    ]);
    // No password in the preview.
    expect(created.preview).toBe('https://shop.example · yannick@example.com');
    expect(created.fields.map((f) => [f.label, f.hidden])).toEqual([
      ['Website', false],
      ['Username', false],
      ['Password', true],
    ]);
    expect(created.createdAt).toBe(created.updatedAt);

    const read = await flow.client.get(`/api/secrets/${created.id}`);
    const detail = await expectJson(read, 200, secretSchema);
    expect(detail.fields[2]).toEqual({
      label: 'Password',
      value: 'hunter2',
      hidden: true,
    });

    const retitled = await flow.client.patch(`/api/secrets/${created.id}`, {
      title: 'Shop',
    });
    const changed = await expectJson(retitled, 200, secretSchema);
    expect(changed.title).toBe('Shop');
    expect(changed.fields).toEqual(detail.fields); // fields untouched

    const refielded = await flow.client.patch(`/api/secrets/${created.id}`, {
      fields: [
        { label: 'Username', value: 'other' },
        { label: 'Password', value: 'new' },
      ],
    });
    const replaced = await expectJson(refielded, 200, secretSchema);
    expect(replaced.fields.map((f) => f.value)).toEqual(['other', 'new']);
    expect(replaced.fields[1]?.hidden).toBe(true);

    const deleted = await flow.client.delete(`/api/secrets/${created.id}`);
    expect(deleted.status).toBe(204);
    await expectError(
      await flow.client.get(`/api/secrets/${created.id}`),
      404,
      'secret_not_found',
    );
    await expectError(
      await flow.client.delete(`/api/secrets/${created.id}`),
      404,
      'secret_not_found',
    );
    await expectError(
      await flow.client.patch('/api/secrets/999', { title: 'x' }),
      404,
      'secret_not_found',
    );
  });
});

describe('the list of secrets', () => {
  it('hides the masked values and filters by kind', async () => {
    await create(LOGIN);
    const card = await create(CARD);
    await create({
      kind: 'note',
      title: 'Todo',
      fields: [{ label: 'Note', value: 'buy milk' }],
    });

    const response = await flow.client.get('/api/secrets');
    const everything = await expectJson(response, 200, summaries);
    // Newest first.
    expect(everything.map((s) => s.title)).toEqual([
      'Todo',
      'Visa',
      'Shop login',
    ]);
    const text = JSON.stringify(everything);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('4242 4242');
    expect(card.preview).not.toContain('123');
    expect(everything.find((s) => s.title === 'Visa')?.preview).toBe(
      '•••• 4242 · Y. Monney · 12/30',
    );

    expect(await titles({ kind: 'card' })).toEqual(['Visa']);
    const unknown = await flow.client.get('/api/secrets', {
      query: { kind: 'diary' },
    });
    await expectError(unknown, 422, 'invalid_kind');
  });

  it('belongs to every session or to one', async () => {
    for (const n of [1, 2]) await addProxy(flow.client, `192.0.2.${n}:8080`);
    const a = await createSession(flow.client, 'a');
    const b = await createSession(flow.client, 'b');
    const everyone = await create({ ...LOGIN, title: 'For everyone' });
    const forA = await create({ ...CARD, title: 'Only a', sessionId: a.id });
    await create({ ...CARD, title: 'Only b', sessionId: b.id });
    expect([forA.session?.id, forA.session?.name]).toEqual([a.id, 'a']);

    expect(await titles()).toEqual(['Only b', 'Only a', 'For everyone']);
    expect(await titles({ scope: 'global' })).toEqual(['For everyone']);
    expect(await titles({ scope: a.id })).toEqual(['Only a']);
    expect(await titles({ scope: a.id, includeGlobal: true })).toEqual([
      'Only a',
      'For everyone',
    ]);
    await expectError(
      await flow.client.get('/api/secrets', { query: { scope: '999' } }),
      404,
      'session_not_found',
    );
    await expectError(
      await flow.client.get('/api/secrets', { query: { scope: 'everything' } }),
      422,
      'invalid_scope',
    );

    // The scope can change, back to everyone too; the kind cannot.
    const moved = await flow.client.patch(`/api/secrets/${everyone.id}`, {
      sessionId: b.id,
    });
    expect((await expectJson(moved, 200, secretSchema)).session?.id).toBe(b.id);
    const freed = await flow.client.patch(`/api/secrets/${forA.id}`, {
      sessionId: null,
    });
    expect((await expectJson(freed, 200, secretSchema)).session).toBeNull();
    expect(await titles({ scope: 'global' })).toEqual(['Only a']);
    const badSession = await flow.client.patch(`/api/secrets/${forA.id}`, {
      sessionId: 999,
    });
    await expectError(badSession, 404, 'session_not_found');
  });

  it('keeps the session of a secret when a change does not name one', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    const secret = await create({ ...CARD, sessionId: session.id });
    const response = await flow.client.patch(`/api/secrets/${secret.id}`, {
      title: 'Renamed',
    });
    const changed = await expectJson(response, 200, secretSchema);
    expect(changed.session?.id).toBe(session.id);
  });

  it('loses the secrets of a session that is deleted', async () => {
    await addProxy(flow.client, '192.0.2.1:8080');
    const session = await createSession(flow.client, 'a');
    await create({ ...CARD, sessionId: session.id });
    const keep = await create(LOGIN);

    const deleted = await flow.client.delete(`/api/sessions/${session.id}`);

    expect(deleted.status).toBe(204);
    const response = await flow.client.get('/api/secrets');
    const left = await expectJson(response, 200, summaries);
    expect(left.map((s) => s.id)).toEqual([keep.id]);
  });
});

describe('a secret that cannot be stored', () => {
  it.each([
    ['no fields', { ...LOGIN, fields: [] }, 422, 'invalid_secret'],
    ['a blank title', { ...LOGIN, title: '  ' }, 422, 'invalid_secret'],
    [
      'a field without a label',
      { ...LOGIN, fields: [{ label: '', value: 'x' }] },
      422,
      'invalid_secret',
    ],
    [
      'a session that does not exist',
      { ...LOGIN, sessionId: 999 },
      404,
      'session_not_found',
    ],
    [
      'a kind that does not exist',
      { ...LOGIN, kind: 'diary' },
      422,
      'validation_error',
    ],
  ])(
    'is refused for %s, and creates nothing',
    async (_name, body, status, code) => {
      const response = await flow.client.post('/api/secrets', body);
      await expectError(response, status, code);
      expect(await titles()).toEqual([]);
    },
  );
});

describe('ids beyond what the database can hold', () => {
  it('are simply unknown', async () => {
    const huge = '100000000000000000000';
    await expectError(
      await flow.client.get(`/api/secrets/${huge}`),
      404,
      'secret_not_found',
    );
    await expectError(
      await flow.client.get(`/api/sessions/${huge}`),
      404,
      'session_not_found',
    );
    await expectError(
      await flow.client.delete(`/api/secrets/${huge}`),
      404,
      'secret_not_found',
    );
    await expectError(
      await flow.client.post(`/api/proxies/${huge}/check`),
      404,
      'proxy_not_found',
    );
    await expectError(
      await flow.client.get('/api/secrets', { query: { scope: huge } }),
      422,
      'invalid_scope',
    );
  });

  it('are refused in a body, which can only hold ids a row can have', async () => {
    const body = {
      kind: 'note',
      title: 'x',
      fields: [{ label: 'Note', value: 'y' }],
      sessionId: 1e20,
    };
    const refused = await flow.client.post('/api/secrets', body);
    const error = await expectError(refused, 422, 'validation_error');
    expect(error.message).toMatch(/^sessionId: /);
    expect(await titles()).toEqual([]);
  });
});
