import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { secretSchema, secretSummarySchema } from '../../../lib/api/schemas.ts';
import {
  secret,
  secretSummary,
  sessionRef,
} from '../../../tests/utils/fixtures.ts';
import { AppError } from '../../errors.ts';
import {
  expectError,
  expectJson,
  stubbedApi,
} from '../../testing/api-client.ts';
import type { Manager } from '../sessions/manager.ts';

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

describe('GET /api/secrets', () => {
  function listing(list = [secretSummary()]) {
    const listSecrets = vi.fn<Manager['listSecrets']>(() => list);
    return { listSecrets, ...stubbedApi({ listSecrets }) };
  }

  it('answers the list the manager makes, without a masked value', async () => {
    const list = [
      secretSummary({ id: 2, title: 'Visa', kind: 'card' }),
      secretSummary({ id: 1, session: sessionRef({ id: 3, name: 'a' }) }),
    ];
    const { client } = listing(list);
    const response = await client.get('/api/secrets');
    expect(await expectJson(response, 200, summaries)).toEqual(list);
  });

  it('lists every secret, of any kind, by default', async () => {
    const { client, listSecrets } = listing();
    await client.get('/api/secrets');
    expect(listSecrets).toHaveBeenCalledExactlyOnceWith({
      scope: 'all',
      kind: null,
      includeGlobal: false,
    });
  });

  it.each([
    ['all', 'all'],
    ['global', 'global'],
    ['7', 7],
    ['007', 7],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
  ])('reads the scope %j', async (scope, expected) => {
    const { client, listSecrets } = listing();
    expect(
      (await client.get('/api/secrets', { query: { scope } })).status,
    ).toBe(200);
    expect(listSecrets).toHaveBeenCalledExactlyOnceWith({
      scope: expected,
      kind: null,
      includeGlobal: false,
    });
  });

  it.each(['card', 'personal', 'credentials', 'note'])(
    'filters by the kind %s',
    async (kind) => {
      const { client, listSecrets } = listing();
      await client.get('/api/secrets', { query: { kind } });
      expect(listSecrets).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind }),
      );
    },
  );

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('reads includeGlobal=%s', async (value, expected) => {
    const { client, listSecrets } = listing();
    await client.get('/api/secrets', {
      query: { scope: 3, includeGlobal: value },
    });
    expect(listSecrets).toHaveBeenCalledExactlyOnceWith({
      scope: 3,
      kind: null,
      includeGlobal: expected,
    });
  });

  it('refuses an includeGlobal that is no flag', async () => {
    const { client, listSecrets } = listing();
    const response = await client.get('/api/secrets', {
      query: { includeGlobal: 'maybe' },
    });
    const error = await expectError(response, 422, 'validation_error');
    expect(error.message).toMatch(/^includeGlobal: /);
    expect(listSecrets).not.toHaveBeenCalled();
  });

  it.each(['everything', '-1', '1.5', '', '1e3', '99999999999999999999', '٣'])(
    'refuses the scope %j with invalid_scope',
    async (scope) => {
      const { client, listSecrets } = listing();
      const response = await client.get('/api/secrets', { query: { scope } });
      const error = await expectError(response, 422, 'invalid_scope');
      expect(error.message).toBe(
        'The scope must be all, global or a session id.',
      );
      expect(listSecrets).not.toHaveBeenCalled();
    },
  );

  it('answers a scope below the first id as a session that does not exist', async () => {
    const { client, listSecrets } = listing();
    const response = await client.get('/api/secrets', { query: { scope: 0 } });
    const error = await expectError(response, 404, 'session_not_found');
    expect(error.message).toBe('Session 0 does not exist.');
    expect(listSecrets).not.toHaveBeenCalled();
  });

  it.each(['diary', '', 'CARD'])(
    'refuses the kind %j with invalid_kind',
    async (kind) => {
      const { client, listSecrets } = listing();
      const response = await client.get('/api/secrets', { query: { kind } });
      const error = await expectError(response, 422, 'invalid_kind');
      expect(error.message).toBe(
        'The kind of secret must be one of: personal, credentials, card, note.',
      );
      expect(listSecrets).not.toHaveBeenCalled();
    },
  );

  it('names a bad scope before a bad kind', async () => {
    const { client } = listing();
    const response = await client.get('/api/secrets', {
      query: { scope: 'everything', kind: 'diary' },
    });
    await expectError(response, 422, 'invalid_scope');
  });

  it('passes on the 404 of a scope that is a session that does not exist', async () => {
    const { client } = stubbedApi({
      listSecrets: () => {
        throw new AppError(
          404,
          'session_not_found',
          'Session 999 does not exist.',
        );
      },
    });
    const response = await client.get('/api/secrets', {
      query: { scope: 999 },
    });
    await expectError(response, 404, 'session_not_found');
  });
});

describe('POST /api/secrets', () => {
  function creating() {
    const createSecret = vi.fn<Manager['createSecret']>(() => secret());
    return { createSecret, ...stubbedApi({ createSecret }) };
  }

  it('answers 201 with the secret as it was stored, masked values included', async () => {
    const created = secret({ id: 4, title: 'Shop login' });
    const { client } = stubbedApi({ createSecret: () => created });
    const response = await client.post('/api/secrets', LOGIN);
    expect(await expectJson(response, 201, secretSchema)).toEqual(created);
  });

  it('hands over the kind, title and fields, for every session by default', async () => {
    const { client, createSecret } = creating();
    await client.post('/api/secrets', LOGIN);
    expect(createSecret).toHaveBeenCalledExactlyOnceWith({
      ...LOGIN,
      sessionId: undefined,
    });
    expect(createSecret.mock.calls[0]?.[0].fields[2]).toEqual({
      label: 'Password',
      value: 'hunter2',
    });
  });

  it('hands over the session it is for, and null for every session', async () => {
    const { client, createSecret } = creating();
    await client.post('/api/secrets', { ...LOGIN, sessionId: 3 });
    await client.post('/api/secrets', { ...LOGIN, sessionId: null });
    expect(createSecret.mock.calls.map(([input]) => input.sessionId)).toEqual([
      3,
      null,
    ]);
  });

  it('fills in an empty value and leaves the masking to the manager', async () => {
    const { client, createSecret } = creating();
    await client.post('/api/secrets', {
      kind: 'note',
      title: 'x',
      fields: [
        { label: 'Empty' },
        { label: 'Masked', value: 'v', hidden: true },
        { label: 'Shown', value: 'v', hidden: false },
        { label: 'Unsaid', value: 'v', hidden: null },
      ],
    });
    expect(createSecret.mock.calls[0]?.[0].fields).toEqual([
      { label: 'Empty', value: '' },
      { label: 'Masked', value: 'v', hidden: true },
      { label: 'Shown', value: 'v', hidden: false },
      { label: 'Unsaid', value: 'v', hidden: null },
    ]);
  });

  it.each([
    ['a kind that does not exist', { ...LOGIN, kind: 'diary' }, 'kind'],
    ['no title', { ...LOGIN, title: undefined }, 'title'],
    ['no fields', { ...LOGIN, fields: undefined }, 'fields'],
    ['fields that are no list', { ...LOGIN, fields: 'x' }, 'fields'],
    [
      'a field without a label',
      { ...LOGIN, fields: [{ value: 'x' }] },
      'fields.0.label',
    ],
    ['a session id of 0', { ...LOGIN, sessionId: 0 }, 'sessionId'],
    [
      'a session id that is no whole number',
      { ...LOGIN, sessionId: 1.5 },
      'sessionId',
    ],
    ['a session id in text', { ...LOGIN, sessionId: '3' }, 'sessionId'],
    [
      'a session id no row can have',
      { ...LOGIN, sessionId: 1e20 },
      'sessionId',
    ],
  ])(
    'refuses %s with a 422 before the manager is asked',
    async (_name, body, path) => {
      const { client, createSecret } = creating();
      const response = await client.post('/api/secrets', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message).toMatch(new RegExp(`^${path}: `));
      expect(createSecret).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'a title of a million characters',
      { ...LOGIN, title: 'x'.repeat(1_000_000) },
      'title',
    ],
    [
      'a label of a million characters',
      { ...LOGIN, fields: [{ label: 'x'.repeat(1_000_000), value: 'v' }] },
      'fields.0.label',
    ],
    [
      'a value of a million characters',
      { ...LOGIN, fields: [{ label: 'Note', value: 'x'.repeat(1_000_000) }] },
      'fields.0.value',
    ],
    [
      'a thousand fields',
      {
        ...LOGIN,
        fields: Array.from({ length: 1000 }, () => ({
          label: 'L',
          value: 'v',
        })),
      },
      'fields',
    ],
  ])(
    'refuses %s with a 422 before the manager is asked',
    async (_name, body, path) => {
      const { client, createSecret } = creating();
      const response = await client.post('/api/secrets', body);
      const error = await expectError(response, 422, 'validation_error');
      expect(error.message).toMatch(new RegExp(`^${path}: Too big`));
      expect(createSecret).not.toHaveBeenCalled();
    },
  );

  it('leaves a value just over its limit to the vault, which has a code of its own', async () => {
    const { client, createSecret } = creating();
    const response = await client.post('/api/secrets', {
      ...LOGIN,
      fields: [{ label: 'Note', value: 'x'.repeat(20_001) }],
    });
    expect(response.status).toBe(201);
    expect(createSecret).toHaveBeenCalledOnce();
  });

  it('never repeats a value it refuses', async () => {
    const { client } = creating();
    const response = await client.post('/api/secrets', {
      ...LOGIN,
      kind: 'hunter2',
      fields: [{ label: 5, value: 'hunter2' }],
    });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('hunter2');
  });

  it.each([
    [422, 'invalid_secret'],
    [404, 'session_not_found'],
  ])('passes on the manager’s %d %s', async (status, code) => {
    const { client } = stubbedApi({
      createSecret: () => {
        throw new AppError(status, code, 'A sentence.');
      },
    });
    await expectError(await client.post('/api/secrets', LOGIN), status, code);
  });
});

describe('GET /api/secrets/:id', () => {
  it('answers the secret with its masked values', async () => {
    const found = secret({ id: 9 });
    const getSecret = vi.fn<Manager['getSecret']>(() => found);
    const { client } = stubbedApi({ getSecret });
    const response = await client.get('/api/secrets/9');
    const body = await expectJson(response, 200, secretSchema);
    expect(body.fields[2]).toEqual({
      label: 'Password',
      value: 'correct horse',
      hidden: true,
    });
    expect(getSecret).toHaveBeenCalledExactlyOnceWith(9);
  });

  it('passes on the 404 of a secret that does not exist', async () => {
    const { client } = stubbedApi({
      getSecret: () => {
        throw new AppError(404, 'secret_not_found', 'Secret 5 does not exist.');
      },
    });
    await expectError(
      await client.get('/api/secrets/5'),
      404,
      'secret_not_found',
    );
  });
});

describe('PATCH /api/secrets/:id', () => {
  function updating() {
    const updateSecret = vi.fn<Manager['updateSecret']>(() => secret());
    return { updateSecret, ...stubbedApi({ updateSecret }) };
  }

  it('answers the secret as it is then', async () => {
    const changed = secret({ id: 2, title: 'Shop' });
    const { client } = stubbedApi({ updateSecret: () => changed });
    const response = await client.patch('/api/secrets/2', { title: 'Shop' });
    expect(await expectJson(response, 200, secretSchema)).toEqual(changed);
  });

  it('changes only what is sent: no session in the body keeps the session', async () => {
    const { client, updateSecret } = updating();
    await client.patch('/api/secrets/2', { title: 'Shop' });
    await client.patch('/api/secrets/2', {});
    expect(updateSecret.mock.calls).toEqual([
      [2, { title: 'Shop', fields: undefined, session: 'keep' }],
      [2, { title: undefined, fields: undefined, session: 'keep' }],
    ]);
  });

  it('tells a session id of null, which frees the secret for every session, from none', async () => {
    const { client, updateSecret } = updating();
    await client.patch('/api/secrets/2', { sessionId: null });
    await client.patch('/api/secrets/2', { sessionId: 8 });
    expect(updateSecret.mock.calls.map(([, update]) => update.session)).toEqual(
      ['global', 8],
    );
  });

  it('hands over new fields', async () => {
    const { client, updateSecret } = updating();
    const fields = [{ label: 'Username', value: 'other' }];
    await client.patch('/api/secrets/2', { fields });
    expect(updateSecret).toHaveBeenCalledExactlyOnceWith(2, {
      title: undefined,
      fields,
      session: 'keep',
    });
  });

  it.each([
    ['a title that is no text', { title: 5 }],
    ['a session id of 0', { sessionId: 0 }],
    ['fields that are no list', { fields: {} }],
  ])('refuses %s with a 422', async (_name, body) => {
    const { client, updateSecret } = updating();
    await expectError(
      await client.patch('/api/secrets/2', body),
      422,
      'validation_error',
    );
    expect(updateSecret).not.toHaveBeenCalled();
  });

  it('refuses a request without a body', async () => {
    const { client } = updating();
    await expectError(
      await client.patch('/api/secrets/2'),
      422,
      'validation_error',
    );
  });

  it('answers 404 for a secret that does not exist before it reads the body', async () => {
    const { client, updateSecret } = updating();
    const response = await client.patch('/api/secrets/0', { title: 'x' });
    await expectError(response, 404, 'secret_not_found');
    expect(updateSecret).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/secrets/:id', () => {
  it('answers 204 with no body', async () => {
    const deleteSecret = vi.fn<Manager['deleteSecret']>();
    const { client } = stubbedApi({ deleteSecret });
    const response = await client.delete('/api/secrets/6');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(deleteSecret).toHaveBeenCalledExactlyOnceWith(6);
  });

  it('passes on the 404 of a secret that does not exist', async () => {
    const { client } = stubbedApi({
      deleteSecret: () => {
        throw new AppError(404, 'secret_not_found', 'Secret 6 does not exist.');
      },
    });
    await expectError(
      await client.delete('/api/secrets/6'),
      404,
      'secret_not_found',
    );
  });
});

describe('the id of a secret in the path', () => {
  const routes: Array<[string, string]> = [
    ['GET', '/api/secrets/'],
    ['PATCH', '/api/secrets/'],
    ['DELETE', '/api/secrets/'],
  ];

  it.each(routes)(
    '%s: text that is not a whole number is a 422',
    async (method, path) => {
      const { client } = stubbedApi();
      for (const id of ['abc', '1.5', '1e3', '%20', 'null']) {
        const response = await client.call(method, `${path}${id}`, {
          body: method === 'PATCH' ? { title: 'x' } : undefined,
        });
        const error = await expectError(response, 422, 'validation_error');
        expect(error.message).toBe(
          'id: Input should be a valid integer, unable to parse string as an integer',
        );
      }
    },
  );

  it.each(routes)(
    '%s: an id no row can have is a 404, without asking the manager',
    async (method, path) => {
      const { client } = stubbedApi();
      const cases: Array<[string, string]> = [
        ['0', 'Secret 0 does not exist.'],
        ['-3', 'Secret -3 does not exist.'],
        ['9007199254740992', 'Secret 9007199254740992 does not exist.'],
        [
          '100000000000000000000',
          'Secret 100000000000000000000 does not exist.',
        ],
      ];
      for (const [id, message] of cases) {
        const response = await client.call(method, `${path}${id}`, {
          body: method === 'PATCH' ? { title: 'x' } : undefined,
        });
        const error = await expectError(response, 404, 'secret_not_found');
        expect(error.message).toBe(message);
      }
    },
  );

  it('reaches the manager with the largest id there is', async () => {
    const getSecret = vi.fn<Manager['getSecret']>(() => secret());
    const { client } = stubbedApi({ getSecret });
    await client.get(`/api/secrets/${Number.MAX_SAFE_INTEGER}`);
    expect(getSecret).toHaveBeenCalledExactlyOnceWith(Number.MAX_SAFE_INTEGER);
  });
});
