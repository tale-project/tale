import { describe, expect, test } from 'bun:test';

import {
  createBackendNativeUpdate,
  nativeClientsSchema,
  reconcileNativeClients,
  type NativeClientContext,
} from './native-client';

const desired = {
  key: 'client-portal',
  clientId: 'existing-client',
  name: 'Client portal',
  redirectUris: ['https://portal.example.org/identity/callback'],
};
const existing = {
  software_id: desired.key,
  client_id: desired.clientId,
  client_name: 'Previous portal name',
  redirect_uris: ['https://legacy.example.org/oauth/callback'],
  disabled: false,
  require_pkce: true,
  skip_consent: false,
  token_endpoint_auth_method: 'client_secret_post',
  grant_types: ['authorization_code'],
  response_types: ['code'],
  scope: 'openid profile email tale:organization',
  type: 'web',
  taleOrganizationId: 'org-fixture',
  client_secret: 'synthetic-stored-secret-never-output',
};

function fixture(overrides: Record<string, unknown> = {}, retain = false) {
  let client = { ...existing, ...overrides };
  const writes: unknown[] = [];
  let reads = 0;
  const context: NativeClientContext = {
    origin: 'https://native.example.org',
    organization: { id: 'org-fixture', slug: 'fixture' },
    headers: () =>
      new Headers({
        cookie: 'session=synthetic',
        origin: 'https://native.example.org',
      }),
    request: async (path, method = 'GET') => {
      expect(path).toBe('/api/app/identity/clients?orgId=org-fixture');
      expect(method).toBe('GET');
      reads++;
      return Response.json({ clients: [client] });
    },
    requireJson: async (response) => response.json(),
  };
  return {
    context,
    writes,
    reads: () => reads,
    update: async (args: {
      headers: Headers;
      body: {
        client_id: string;
        update: { client_name: string; redirect_uris: string[] };
      };
    }) => {
      expect(args.headers.get('cookie')).toBe('session=synthetic');
      writes.push(args.body);
      if (!retain) client = { ...client, ...args.body.update };
    },
    client: () => client,
  };
}

describe('native client convergence', () => {
  test('supports a generic second domain, preserves credentials/policy and repeats without a write', async () => {
    const f = fixture();
    const first = await reconcileNativeClients(f.context, [desired], f.update);
    const second = await reconcileNativeClients(f.context, [desired], f.update);
    expect(first).toEqual([
      { key: desired.key, clientId: desired.clientId, changed: true },
    ]);
    expect(second).toEqual([
      { key: desired.key, clientId: desired.clientId, changed: false },
    ]);
    expect(f.writes).toEqual([
      {
        client_id: desired.clientId,
        update: {
          client_name: desired.name,
          redirect_uris: desired.redirectUris,
        },
      },
    ]);
    expect(f.client().client_secret).toBe(existing.client_secret);
    expect(JSON.stringify(first)).not.toContain(existing.client_secret);
  });

  test('an exact no-op works without loading a backend adapter', async () => {
    const f = fixture({
      client_name: desired.name,
      redirect_uris: desired.redirectUris,
    });
    expect(await reconcileNativeClients(f.context, [desired])).toEqual([
      { key: desired.key, clientId: desired.clientId, changed: false },
    ]);
    expect(f.reads()).toBe(1);
  });

  test('holds an external update without a supported adapter', async () => {
    const f = fixture();
    await expect(reconcileNativeClients(f.context, [desired])).rejects.toThrow(
      'backend-local',
    );
    expect(f.writes).toHaveLength(0);
  });

  test.each([
    { client_id: 'foreign-id' },
    { taleOrganizationId: 'foreign-org' },
    { require_pkce: false },
    { disabled: true },
    { skip_consent: true },
    { token_endpoint_auth_method: 'none' },
    { grant_types: ['authorization_code', 'refresh_token'] },
    { response_types: ['token'] },
    { scope: 'openid profile' },
    { type: 'native' },
  ])(
    'refuses identity or security drift before mutation: %j',
    async (change) => {
      const f = fixture(change);
      await expect(
        reconcileNativeClients(f.context, [desired], f.update),
      ).rejects.toThrow();
      expect(f.writes).toHaveLength(0);
    },
  );

  test('does not accept success without exact readback', async () => {
    const f = fixture({}, true);
    await expect(
      reconcileNativeClients(f.context, [desired], f.update),
    ).rejects.toThrow('did not converge');
  });

  test('refuses drift in an earlier client while converging a later client', async () => {
    const f = fixture();
    const second = {
      ...desired,
      key: 'second-portal',
      clientId: 'second-client',
      redirectUris: ['https://second.example.org/oauth/callback'],
    };
    let clients = [
      { ...existing },
      { ...existing, software_id: second.key, client_id: second.clientId },
    ];
    f.context.request = async () => Response.json({ clients });
    let updates = 0;
    await expect(
      reconcileNativeClients(f.context, [desired, second], async ({ body }) => {
        updates++;
        clients = clients.map((client) =>
          client.client_id === body.client_id
            ? { ...client, ...body.update }
            : client,
        );
        if (updates === 2)
          clients[0] = {
            ...clients[0],
            redirect_uris: ['https://drift.example.org/callback'],
          };
      }),
    ).rejects.toThrow('did not converge');
    expect(updates).toBe(2);
  });

  test.each(
    [
      { clients: [] },
      { clients: [existing, existing] },
      { clients: [{ ...existing, redirect_uris: null }] },
      { clients: null },
      null,
    ].map((response) => ({ response })),
  )(
    'refuses missing, ambiguous or malformed native client responses',
    async ({ response }) => {
      const f = fixture();
      f.context.request = async () => Response.json(response);
      await expect(
        reconcileNativeClients(f.context, [desired], f.update),
      ).rejects.toThrow();
      expect(f.writes).toHaveLength(0);
    },
  );

  test('preflights the second client before changing the first', async () => {
    const f = fixture();
    const second = {
      ...desired,
      key: 'second-portal',
      clientId: 'second-client',
    };
    f.context.request = async () =>
      Response.json({
        clients: [
          existing,
          {
            ...existing,
            software_id: second.key,
            client_id: second.clientId,
            require_pkce: false,
          },
        ],
      });
    await expect(
      reconcileNativeClients(f.context, [desired, second], f.update),
    ).rejects.toThrow('security policy');
    expect(f.writes).toHaveLength(0);
  });

  test('validates every declared client before contacting the API', async () => {
    const f = fixture();
    for (const clients of [
      [desired, desired],
      [{ ...desired, redirectUris: [] }],
      [{ ...desired, redirectUris: ['http://portal.example.org/callback'] }],
      [
        {
          ...desired,
          redirectUris: ['https://user:secret@example.org/callback'],
        },
      ],
      [{ ...desired, redirectUris: ['https://example.org/callback#fragment'] }],
      [
        {
          ...desired,
          redirectUris: [desired.redirectUris[0], desired.redirectUris[0]],
        },
      ],
      [{ ...desired, unknown: 'secret' }],
    ]) {
      expect(nativeClientsSchema.safeParse(clients).success).toBe(false);
      await expect(
        reconcileNativeClients(f.context, clients, f.update),
      ).rejects.toThrow();
    }
    expect(f.reads()).toBe(0);
  });

  test('redacts adapter exceptions', async () => {
    const f = fixture();
    await expect(
      reconcileNativeClients(f.context, [desired], async () => {
        throw new Error(existing.client_secret);
      }),
    ).rejects.toThrow('Native client update failed');
  });
});

describe('backend-local native compatibility adapter', () => {
  function backendFixture(failAt?: string) {
    const loaded: string[] = [];
    const closed: string[] = [];
    const writes: unknown[] = [];
    const sql = {
      end: async () => {
        closed.push('sql');
        if (failAt === 'sql-close') throw new Error('secret-close');
      },
    };
    const auth = {
      api: {
        adminUpdateOAuthClient: async (args: unknown) => {
          writes.push(args);
          if (failAt === 'update') throw new Error('secret-native');
        },
      },
      options: {
        database: {
          end: async () => {
            closed.push('auth');
            if (failAt === 'auth-close') throw new Error('secret-close');
          },
        },
      },
    };
    const update = createBackendNativeUpdate({
      origin: 'https://native.example.org',
      env: {
        DATABASE_URL: 'postgres://synthetic-private',
        BETTER_AUTH_SECRET: 'synthetic-auth-secret',
      },
      loadModule: async (id) => {
        loaded.push(id);
        if (failAt === 'load') throw new Error('secret-import');
        if (id.endsWith('/db/sql.ts')) return { createSql: () => sql };
        return {
          createAuth: (config: { sql: unknown; baseUrl: string }) => {
            expect(config.sql).toBe(sql);
            expect(config.baseUrl).toBe('https://native.example.org');
            if (failAt === 'create') throw new Error('secret-create');
            return auth;
          },
        };
      },
    });
    return { loaded, closed, writes, update };
  }
  const args = {
    headers: new Headers({ cookie: 'session=synthetic' }),
    body: {
      client_id: desired.clientId,
      update: {
        client_name: desired.name,
        redirect_uris: desired.redirectUris,
      },
    },
  };

  test('loads only fixed backend modules lazily and closes both pools', async () => {
    const f = backendFixture();
    expect(f.loaded).toEqual([]);
    await f.update(args);
    expect(f.loaded.sort()).toEqual([
      '/app/backend/auth/auth.ts',
      '/app/backend/db/sql.ts',
    ]);
    expect(f.closed.sort()).toEqual(['auth', 'sql']);
    expect(f.writes).toEqual([args]);
  });

  test.each(['update', 'sql-close', 'auth-close'])(
    'cleans both pools after %s and scrubs errors',
    async (failAt) => {
      const f = backendFixture(failAt);
      const error = await f.update(args).catch((value) => value);
      expect(error.message).not.toContain('secret');
      expect(f.closed.sort()).toEqual(['auth', 'sql']);
    },
  );

  test('closes the SQL pool if auth construction fails', async () => {
    const f = backendFixture('create');
    await expect(f.update(args)).rejects.toThrow('Native client update failed');
    expect(f.closed).toEqual(['sql']);
  });

  test('refuses missing managed backend environment before loading code', async () => {
    let loaded = false;
    const update = createBackendNativeUpdate({
      origin: 'https://native.example.org',
      env: {},
      loadModule: async () => {
        loaded = true;
        return {};
      },
    });
    await expect(update(args)).rejects.toThrow('managed backend');
    expect(loaded).toBe(false);
  });

  test('refuses extra write fields and module paths before loading code', async () => {
    const f = backendFixture();
    for (const update of [
      { ...args.body.update, client_secret: 'synthetic-rotation-not-allowed' },
      { ...args.body.update, require_pkce: false },
      { ...args.body.update, modulePath: '/tmp/untrusted.ts' },
    ])
      await expect(
        f.update({ ...args, body: { ...args.body, update } }),
      ).rejects.toThrow('Invalid managed native client update');
    expect(f.loaded).toEqual([]);
    expect(f.writes).toEqual([]);
    expect(f.closed).toEqual([]);
  });

  test('redacts module load failures before opening any pools', async () => {
    const f = backendFixture('load');
    const error = await f.update(args).catch((value) => value);
    expect(error.message).toBe('Native client update failed.');
    expect(error.info.code).toBe(5);
    expect(error.info.cause).toBeUndefined();
    expect(f.closed).toEqual([]);
    expect(f.writes).toEqual([]);
  });
});
