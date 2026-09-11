import { describe, expect, test } from 'bun:test';

import { createOidcProvider } from '../../../../../services/platform/backend/auth/oidc';
import { clientExportTargetSchema } from './client-export-model';
import { createBackendClientExportVerifier } from './client-export-native';
import {
  createBackendNativeClients,
  intentSchema,
  type BackendAdapterOptions,
  type NativeClientCreateArgs,
} from './native-client';

async function nativeFixture() {
  const user = {
    id: 'native-operator',
    email: 'operator@example.invalid',
    emailVerified: true,
    banned: false,
  };
  const organization = { id: 'native-org', slug: 'example', name: 'Example' };
  const member = {
    organizationId: organization.id,
    userId: user.id,
    role: 'owner',
  };
  const records = new Map<string, Record<string, unknown>>();
  let writes = 0;
  let closes = 0;
  let introspections = 0;
  let duplicate = false;
  let memberDuplicate = false;
  const adapter = {
    create: async ({
      model,
      data,
    }: {
      model: string;
      data: Record<string, unknown>;
    }) => {
      expect(model).toBe('oauthClient');
      writes++;
      const record = JSON.parse(JSON.stringify({ ...data, disabled: false }));
      records.set(String(data.clientId), record);
      return record;
    },
    findOne: async ({
      model,
      where,
    }: {
      model: string;
      where: { field: string; value: unknown }[];
    }) => {
      if (model === 'oauthAccessToken') return null;
      if (model === 'oauthClient')
        return records.get(String(where[0].value)) ?? null;
      expect(model).toBe('organization');
      expect(where).toEqual([
        { field: 'id', value: 'native-org' },
        { field: 'slug', value: 'example' },
      ]);
      return organization;
    },
    findMany: async ({
      model,
      where,
      limit,
    }: {
      model: string;
      where: { field: string; value: unknown }[];
      limit: number;
    }) => {
      expect(limit).toBe(2);
      if (model === 'member') {
        expect(where).toEqual([
          { field: 'organizationId', value: 'native-org' },
          { field: 'userId', value: 'native-operator' },
        ]);
        return memberDuplicate ? [member, member] : [member];
      }
      expect(model).toBe('oauthClient');
      expect(where).toEqual([
        { field: 'referenceId', value: 'native-org' },
        { field: 'softwareId', value: 'portal' },
      ]);
      const values = [...records.values()];
      return duplicate ? [values[0], values[0]] : values;
    },
  };
  const options: BackendAdapterOptions = {
    origin: 'https://native.example.invalid',
    env: {
      DATABASE_URL: 'isolated-test-database',
      BETTER_AUTH_SECRET: 'isolated-native-secret-only',
    },
    loadModule: async (path) => {
      if (path.endsWith('/db/sql.ts'))
        return {
          createSql: () => ({
            end: async () => {
              closes++;
            },
          }),
        };
      expect(path).toBe('/app/backend/auth/auth.ts');
      return {
        createAuth: () => {
          const plugin = createOidcProvider(
            (async () => [{ role: 'owner' }]) as unknown as Parameters<
              typeof createOidcProvider
            >[0],
            'https://native.example.invalid',
          );
          const context = {
            session: {
              user,
              session: {
                id: 'synthetic-session',
                userId: user.id,
                activeOrganizationId: organization.id,
              },
            },
            options: {
              plugins: [
                plugin,
                { id: 'jwt', options: { jwt: { issuer: options.origin } } },
              ],
            },
            getPlugin: (key: string) =>
              key === 'jwt'
                ? { id: 'jwt', options: { jwt: { issuer: options.origin } } }
                : plugin,
            baseURL: options.origin,
            adapter,
            internalAdapter: {
              findUserById: async (id: string) => {
                expect(id).toBe('native-operator');
                return user;
              },
            },
          };
          return {
            options: {
              plugins: [plugin],
              database: {
                end: async () => {
                  closes++;
                },
              },
            },
            $context: Promise.resolve(context),
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
              }) => {
                introspections++;
                return plugin.endpoints.oauth2Introspect({
                  ...args,
                  context: context as never,
                });
              },
            },
          };
        },
      };
    },
  };
  const intent = intentSchema.parse({
    schemaVersion: 1,
    phase: 'ready',
    origin: options.origin,
    organizationId: organization.id,
    operatorUserId: user.id,
    body: {
      client_name: 'Example portal',
      software_id: 'portal',
      redirect_uris: ['https://portal.example.invalid/callback'],
      scope: 'openid profile email tale:organization',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      type: 'web',
      require_pkce: true,
      skip_consent: false,
      metadata: { taleOrganizationId: organization.id },
    },
    credentials: { clientId: 'native-client', clientSecret: 'a'.repeat(43) },
  });
  await createBackendNativeClients(options).create({
    headers: new Headers({ cookie: 'synthetic-native-session' }),
    body: intent.body,
    credentials: intent.credentials,
  });
  const target = clientExportTargetSchema.parse({
    schemaVersion: 1,
    deployment: {
      name: 'example',
      bundleSha256: 'a'.repeat(64),
      readyReceiptSha256: 'b'.repeat(64),
      cliRevision: 'c'.repeat(40),
      runtimeRevision: 'd'.repeat(40),
    },
    origin: options.origin,
    organization,
    userId: user.id,
    email: user.email,
    client: {
      key: 'portal',
      name: intent.body.client_name,
      redirectUris: intent.body.redirect_uris,
      clientId: intent.credentials.clientId,
      credentialsSha256: 'f'.repeat(64),
    },
  });
  return {
    options,
    intent,
    target,
    user,
    organization,
    member,
    records,
    verify: createBackendClientExportVerifier(options),
    get writes() {
      return writes;
    },
    get closes() {
      return closes;
    },
    get introspections() {
      return introspections;
    },
    set duplicate(value: boolean) {
      duplicate = value;
    },
    set memberDuplicate(value: boolean) {
      memberDuplicate = value;
    },
  };
}
describe('supported native credential export readback', () => {
  test('real provider creation hash and introspection validate without token issuance or further native writes', async () => {
    const f = await nativeFixture();
    const row = JSON.stringify([...f.records]);
    expect(row).not.toContain(f.intent.credentials.clientSecret);
    const one = await f.verify(f.target, f.intent);
    const two = await f.verify(f.target, f.intent);
    expect(one).toMatch(/^[a-f0-9]{64}$/);
    expect(two).toBe(one);
    expect(f.writes).toBe(1);
    expect(f.introspections).toBe(2);
    expect(f.closes).toBe(10);
    expect(JSON.stringify([...f.records])).toBe(row);
  });
  test.each([
    'disabled',
    'pkce',
    'consent',
    'public',
    'scope',
    'grant',
    'type',
    'callback',
    'client-id',
    'key',
    'reference',
    'metadata',
    'secret',
    'user-id',
    'email',
    'banned',
    'organization-id',
    'organization-slug',
    'organization-name',
    'member-user',
    'member-org',
    'member-role',
    'duplicate-client',
    'duplicate-member',
    'attestation-reversed',
  ])('native %s drift refuses read-only export', async (change) => {
    const f = await nativeFixture();
    const client = f.records.get('native-client')!;
    if (change === 'disabled') client.disabled = true;
    if (change === 'pkce') client.requirePKCE = false;
    if (change === 'consent') client.skipConsent = true;
    if (change === 'public') client.public = true;
    if (change === 'scope') client.scopes = ['openid', 'email'];
    if (change === 'grant')
      client.grantTypes = ['authorization_code', 'refresh_token'];
    if (change === 'type') client.type = 'native';
    if (change === 'callback')
      client.redirectUris = ['https://foreign.invalid/callback'];
    if (change === 'client-id') client.clientId = 'foreign';
    if (change === 'key') client.softwareId = 'foreign';
    if (change === 'reference') client.referenceId = 'foreign';
    if (change === 'metadata')
      client.metadata = { taleOrganizationId: 'foreign' };
    if (change === 'secret') f.intent.credentials.clientSecret = 'b'.repeat(43);
    if (change === 'user-id') f.user.id = 'foreign';
    if (change === 'email') f.user.email = 'foreign@example.invalid';
    if (change === 'banned') f.user.banned = true;
    if (change === 'organization-id') f.organization.id = 'foreign';
    if (change === 'organization-slug') f.organization.slug = 'foreign';
    if (change === 'organization-name') f.organization.name = 'Foreign';
    if (change === 'member-user') f.member.userId = 'foreign';
    if (change === 'member-org') f.member.organizationId = 'foreign';
    if (change === 'member-role') f.member.role = 'member';
    if (change === 'duplicate-client') f.duplicate = true;
    if (change === 'duplicate-member') f.memberDuplicate = true;
    if (change === 'attestation-reversed') {
      f.target.emailVerification = {
        method: 'operator-attested',
        userId: 'native-operator',
        email: 'operator@example.invalid',
        emailVerified: true,
        receipt: {
          path: '/app/data/synthetic-proof.json',
          sha256: 'a'.repeat(64),
        },
      };
      f.user.emailVerified = false;
    }
    try {
      await f.verify(f.target, f.intent);
      throw Error('Unverified credentials exported');
    } catch (error) {
      expect(String(error)).toContain(
        'Native credential export verification failed',
      );
      expect(String(error)).not.toContain(f.intent.credentials.clientSecret);
    }
    expect(f.writes).toBe(1);
  });
});
