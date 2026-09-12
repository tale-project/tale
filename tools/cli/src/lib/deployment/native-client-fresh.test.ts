import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOidcProvider } from '../../../../../services/platform/backend/auth/oidc';
import {
  createBackendNativeClients,
  reconcileNativeClients,
  type ManagedClientOptions,
  type NativeClientContext,
  type NativeClientCreateArgs,
} from './native-client';

const desired = {
  key: 'portal',
  name: 'North portal',
  managed: true,
  redirectUris: ['https://portal.example.org/auth/callback'],
} as const;
const expectedPolicy = {
  disabled: false,
  require_pkce: true,
  skip_consent: false,
  token_endpoint_auth_method: 'client_secret_post',
  grant_types: ['authorization_code'],
  response_types: ['code'],
  scope: 'openid profile email tale:organization',
  type: 'web',
  taleOrganizationId: 'org-north',
};
async function fixture(
  body: (f: ReturnType<typeof createFixture>) => Promise<void>,
) {
  const f = createFixture();
  try {
    await body(f);
  } finally {
    rmSync(f.root, { force: true, recursive: true });
  }
}
function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'tale-fresh-client-'));
  const clients: Record<string, unknown>[] = [];
  const secrets = new Map<string, string>();
  const creates: NativeClientCreateArgs[] = [];
  let loseResponse = false;
  const context: NativeClientContext = {
    origin: 'https://native.example.org',
    organization: { id: 'org-north', slug: 'north' },
    user: { id: 'operator-north' },
    headers: () => new Headers({ cookie: 'synthetic-session' }),
    request: async (path, method = 'GET') => {
      expect(path).toBe('/api/app/identity/clients?orgId=org-north');
      expect(method).toBe('GET');
      return Response.json({ clients });
    },
    requireJson: async (response) => response.json(),
  };
  const managed: ManagedClientOptions = {
    stateDirectory: root,
    create: async (args) => {
      const retained = JSON.parse(
        readFileSync(
          join(root, 'private', `client-${args.body.software_id}.json`),
          'utf8',
        ),
      );
      expect(retained.phase).toBe('pending');
      expect(retained.credentials).toEqual(args.credentials);
      creates.push(args);
      clients.push({
        ...expectedPolicy,
        software_id: args.body.software_id,
        client_id: args.credentials.clientId,
        client_name: args.body.client_name,
        redirect_uris: args.body.redirect_uris,
      });
      secrets.set(args.credentials.clientId, args.credentials.clientSecret);
      if (loseResponse) throw new Error('synthetic-response-loss-private');
    },
    verify: async (credentials) => {
      if (secrets.get(credentials.clientId) !== credentials.clientSecret)
        throw new Error('synthetic-secret-mismatch');
    },
  };
  return {
    root,
    clients,
    secrets,
    creates,
    context,
    managed,
    loseResponse: () => {
      loseResponse = true;
    },
  };
}

// These native-intent cases need POSIX private-file durability, as required by
// the public managed command's Windows refusal. Adapter/policy tests stay portable.
const testPosix = test.skipIf(process.platform === 'win32');

testPosix(
  'fresh clients journal before create, preserve exact credentials and replay with no write',
  async () =>
    fixture(async (f) => {
      const first = await reconcileNativeClients(
        f.context,
        [desired],
        undefined,
        f.managed,
      );
      const credentials = first[0].credentials!;
      const bytes = readFileSync(credentials.path);
      const saved = JSON.parse(bytes.toString());
      expect(first[0].changed).toBe(true);
      expect(saved.phase).toBe('ready');
      expect(first[0].clientId).toBe(saved.credentials.clientId);
      expect(JSON.stringify(first)).not.toContain(
        saved.credentials.clientSecret,
      );
      expect(Bun.CryptoHasher.hash('sha256', bytes, 'hex')).toBe(
        credentials.sha256,
      );
      const repeated = await reconcileNativeClients(
        f.context,
        [desired],
        undefined,
        f.managed,
      );
      expect(repeated[0]).toEqual({ ...first[0], changed: false });
      expect(f.creates).toHaveLength(1);
      expect(readFileSync(credentials.path)).toEqual(bytes);
    }),
);

testPosix(
  'accepted response loss recovers the same client and secret without another create',
  async () =>
    fixture(async (f) => {
      f.loseResponse();
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow('retained intent');
      const file = join(f.root, 'private/client-portal.json');
      const pending = JSON.parse(readFileSync(file, 'utf8'));
      expect(pending.phase).toBe('pending');
      const recovered = await reconcileNativeClients(
        f.context,
        [desired],
        undefined,
        f.managed,
      );
      expect(recovered[0].clientId).toBe(pending.credentials.clientId);
      expect(JSON.parse(readFileSync(file, 'utf8')).credentials).toEqual(
        pending.credentials,
      );
      expect(f.creates).toHaveLength(1);
    }),
);

testPosix(
  'unknown acceptance, lost state, rotated secrets and target drift hold without replacement',
  async () =>
    fixture(async (f) => {
      f.managed.create = async () => {
        throw new Error('request-not-accepted');
      };
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow();
      const file = join(f.root, 'private/client-portal.json');
      const retained = readFileSync(file);
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow('identity');
      expect(readFileSync(file)).toEqual(retained);
      const saved = JSON.parse(retained.toString());
      f.clients.push({
        ...expectedPolicy,
        software_id: desired.key,
        client_id: saved.credentials.clientId,
        client_name: desired.name,
        redirect_uris: desired.redirectUris,
      });
      f.secrets.set(saved.credentials.clientId, 'rotated-secret');
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow('credential verification');
      expect(readFileSync(file)).toEqual(retained);
      f.secrets.set(saved.credentials.clientId, saved.credentials.clientSecret);
      f.context.user = { id: 'other-operator' };
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow('target');
      f.context.user = { id: 'operator-north' };
      rmSync(file);
      await expect(
        reconcileNativeClients(f.context, [desired], undefined, f.managed),
      ).rejects.toThrow('identity');
      expect(readdirSync(join(f.root, 'private'))).toEqual([]);
    }),
);

test('all client conflicts are admitted before any earlier fresh client is created', async () =>
  fixture(async (f) => {
    f.clients.push({
      ...expectedPolicy,
      software_id: 'taken',
      client_id: 'foreign',
      client_name: 'Taken',
      redirect_uris: desired.redirectUris,
    });
    await expect(
      reconcileNativeClients(
        f.context,
        [desired, { ...desired, key: 'taken' }],
        undefined,
        f.managed,
      ),
    ).rejects.toThrow('identity');
    expect(f.creates).toHaveLength(0);
    expect(readdirSync(f.root)).toEqual([]);
    for (const [field, value] of [
      ['key', 'portal\n'],
      ['name', 'North\n'],
      ['redirectUris', ['https://portal.example.org/\n']],
    ] as const)
      await expect(
        reconcileNativeClients(
          f.context,
          [{ ...desired, [field]: value }],
          undefined,
          f.managed,
        ),
      ).rejects.toThrow('input');
  }));

testPosix(
  'retained managed callbacks can converge without rotating their secret',
  async () =>
    fixture(async (f) => {
      const first = await reconcileNativeClients(
        f.context,
        [desired],
        undefined,
        f.managed,
      );
      const bytes = readFileSync(first[0].credentials!.path);
      const renamed = {
        ...desired,
        name: 'North portal revised',
        redirectUris: ['https://portal.example.org/new/callback'],
      };
      const result = await reconcileNativeClients(
        f.context,
        [renamed],
        async ({ body }) => {
          Object.assign(f.clients[0], body.update);
        },
        f.managed,
      );
      expect(result[0].changed).toBe(true);
      expect(f.creates).toHaveLength(1);
      expect(readFileSync(first[0].credentials!.path)).toEqual(bytes);
    }),
);

test('actual pinned provider closures honor intent callbacks and authenticate retained secrets without issuing tokens', async () => {
  const records = new Map<string, Record<string, unknown>>();
  let writes = 0;
  let closed = 0;
  const adapters = createBackendNativeClients({
    origin: 'https://native.example.org',
    env: { DATABASE_URL: 'synthetic-db', BETTER_AUTH_SECRET: 'synthetic-auth' },
    loadModule: async (path) => {
      if (path.endsWith('/db/sql.ts'))
        return {
          createSql: () => ({
            end: async () => {
              closed++;
            },
          }),
        };
      return {
        createAuth: () => {
          // Real native policy and real OAuth endpoint implementation; only the
          // storage/session boundary is injected. No PostgreSQL or HTTP target.
          const sql = (async () => [
            {
              id: 'member',
              organizationId: 'org-north',
              userId: 'operator-north',
              role: 'owner',
            },
          ]) as unknown as Parameters<typeof createOidcProvider>[0];
          const plugin = createOidcProvider(sql, 'https://native.example.org');
          const context = {
            session: {
              user: { id: 'operator-north' },
              session: {
                userId: 'operator-north',
                activeOrganizationId: 'org-north',
              },
            },
            options: {
              plugins: [
                plugin,
                {
                  id: 'jwt',
                  options: { jwt: { issuer: 'https://native.example.org' } },
                },
              ],
            },
            getPlugin: (key: string) =>
              key === 'jwt'
                ? {
                    id: 'jwt',
                    options: { jwt: { issuer: 'https://native.example.org' } },
                  }
                : plugin,
            baseURL: 'https://native.example.org',
            adapter: {
              create: async ({
                model,
                data,
              }: {
                model: string;
                data: Record<string, unknown>;
              }) => {
                expect(model).toBe('oauthClient');
                writes++;
                expect(records.has(String(data.clientId))).toBe(false);
                records.set(String(data.clientId), data);
                return data;
              },
              findOne: async ({
                model,
                where,
              }: {
                model: string;
                where: { value: unknown }[];
              }) => {
                if (model === 'oauthClient')
                  return records.get(String(where[0].value)) ?? null;
                expect(model).toBe('oauthAccessToken');
                return null;
              },
            },
          };
          return {
            options: {
              plugins: [plugin],
              database: {
                end: async () => {
                  closed++;
                },
              },
            },
            api: {
              adminCreateOAuthClient: (
                args: Pick<NativeClientCreateArgs, 'headers' | 'body'>,
              ) =>
                plugin.endpoints.adminCreateOAuthClient({
                  ...args,
                  context: context as never,
                }),
              oauth2Introspect: (args: {
                body: {
                  client_id: string;
                  client_secret: string;
                  token: string;
                  token_type_hint: 'access_token';
                };
              }) =>
                plugin.endpoints.oauth2Introspect({
                  ...args,
                  context: context as never,
                }),
            },
          };
        },
      };
    },
  });
  const credentials = {
    clientId: 'isolated-intent-id',
    clientSecret: 'a'.repeat(43),
  };
  await adapters.create({
    headers: new Headers({ cookie: 'synthetic-session' }),
    credentials,
    body: {
      client_name: desired.name,
      software_id: desired.key,
      redirect_uris: [...desired.redirectUris],
      scope: 'openid profile email tale:organization',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      type: 'web',
      require_pkce: true,
      skip_consent: false,
      metadata: { taleOrganizationId: 'org-north' },
    },
  });
  expect(records.get(credentials.clientId)?.clientSecret).not.toBe(
    credentials.clientSecret,
  );
  await adapters.verify(credentials);
  await expect(
    adapters.verify({ ...credentials, clientSecret: 'b'.repeat(43) }),
  ).rejects.toThrow();
  expect(writes).toBe(1);
  expect(closed).toBe(6);
});

test.each([
  { grantTypes: ['authorization_code', 'refresh_token'] },
  { allowDynamicClientRegistration: true },
  { allowUnauthenticatedClientRegistration: true },
  { storeClientSecret: 'encrypted' },
  { disableJwtPlugin: true },
  { validAudiences: ['https://other.example.org'] },
  { scopes: ['openid', 'profile', 'email'] },
  { codeExpiresIn: 600 },
  { prefix: { clientSecret: 'prefix' } },
  { generateClientId: () => 'foreign' },
])(
  'native policy drift refuses before generator installation or client writes',
  async (change) => {
    let writes = 0;
    let closes = 0;
    const plugin = createOidcProvider(
      (async () => []) as unknown as Parameters<typeof createOidcProvider>[0],
      'https://native.example.org',
    );
    Object.assign(plugin.options, change);
    const before = { ...plugin.options };
    const adapters = createBackendNativeClients({
      origin: 'https://native.example.org',
      env: { DATABASE_URL: 'synthetic', BETTER_AUTH_SECRET: 'synthetic' },
      loadModule: async (path) =>
        path.endsWith('/db/sql.ts')
          ? {
              createSql: () => ({
                end: async () => {
                  closes++;
                },
              }),
            }
          : {
              createAuth: () => ({
                options: {
                  plugins: [plugin],
                  database: {
                    end: async () => {
                      closes++;
                    },
                  },
                },
                api: {
                  adminCreateOAuthClient: async () => {
                    writes++;
                  },
                  oauth2Introspect: async () => ({ active: false }),
                },
              }),
            },
    });
    await expect(
      adapters.create({
        headers: new Headers(),
        credentials: { clientId: 'intent-id', clientSecret: 'a'.repeat(43) },
        body: {
          client_name: desired.name,
          software_id: desired.key,
          redirect_uris: [...desired.redirectUris],
          scope: 'openid profile email tale:organization',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          type: 'web',
          require_pkce: true,
          skip_consent: false,
          metadata: { taleOrganizationId: 'org-north' },
        },
      }),
    ).rejects.toThrow();
    expect(writes).toBe(0);
    expect(closes).toBe(2);
    expect(plugin.options).toEqual(before);
  },
);

test.each([
  {
    status: 'BAD_REQUEST',
    statusCode: 400,
    body: {
      error: 'invalid_client',
      error_description: 'Invalid access token',
    },
  },
  {
    status: 'UNAUTHORIZED',
    statusCode: 401,
    body: {
      error: 'invalid_request',
      error_description: 'Invalid access token',
    },
  },
  {
    status: 'BAD_REQUEST',
    statusCode: 400,
    body: {
      error: 'invalid_request',
      error_description: 'missing a required token for introspection',
    },
  },
  { status: 'BAD_REQUEST', statusCode: 400 },
])(
  'credential proof refuses authentication or generic token errors',
  async (error) => {
    const adapters = createBackendNativeClients({
      origin: 'https://native.example.org',
      env: { DATABASE_URL: 'synthetic', BETTER_AUTH_SECRET: 'synthetic' },
      loadModule: async (path) =>
        path.endsWith('/db/sql.ts')
          ? { createSql: () => ({ end: async () => undefined }) }
          : {
              createAuth: () => ({
                options: {
                  plugins: [
                    createOidcProvider(
                      (async () => []) as unknown as Parameters<
                        typeof createOidcProvider
                      >[0],
                      'https://native.example.org',
                    ),
                  ],
                  database: { end: async () => undefined },
                },
                api: {
                  adminCreateOAuthClient: async () => undefined,
                  oauth2Introspect: async () => {
                    throw error;
                  },
                },
              }),
            },
    });
    await expect(
      adapters.verify({ clientId: 'intent-id', clientSecret: 'a'.repeat(43) }),
    ).rejects.toThrow();
  },
);
