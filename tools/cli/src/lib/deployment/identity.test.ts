import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyProvisionIdentity } from '../../commands/deploy/provision';
import { externalDepError, preconditionError } from '../../utils/fail';
import type { BreakGlassAccount } from './break-glass';
import { deploymentBundleSchema } from './bundle';
import {
  configureInstance,
  parsePrivateInstanceJson,
  PRIVATE_INPUT_LIMIT,
  type InstanceOptions,
} from './identity';
import { intentSchema } from './native-client';
import type { OperatorAddress } from './operator-address';
import { provisionStatePath, writeProvisionState } from './provision-state';

const INPUT = {
  email: 'operator@example.org',
  password: 'synthetic-password-private',
  slug: 'example-team',
  name: 'Example team',
  origin: 'https://native.example.org',
};
const ENTRA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  clientSecret: 'synthetic-provider-private',
};
const MANAGED = {
  configured: true,
  enabled: true,
  protocol: 'oidc',
  displayName: 'Microsoft Entra ID',
  oidc: {
    providerId: 'entra-id',
    issuer: `https://login.microsoftonline.com/${ENTRA.tenantId}/v2.0`,
  },
  otherOrgsEnabled: false,
};
const ABSENT = {
  configured: false,
  enabled: false,
  protocol: null,
  oidc: null,
  otherOrgsEnabled: false,
};
interface Call {
  path: string;
  method: string;
  body: unknown;
  cookie: string;
}
interface Member {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
}
interface FixtureOptions {
  nativeClients?: unknown[];
  /** The native account's current sign-in address; others answer 401. */
  account?: { email: string };
  members?: Member[];
  ignoreMemberWrites?: boolean;
  loginStatus?: number;
  signupStatus?: number;
  challenge?: boolean;
  enrollRequired?: boolean;
  noCookie?: boolean;
  session?: unknown;
  selectedSession?: unknown;
  organizations?: unknown;
  createdOrganization?: unknown;
  connection?: Record<string, unknown>;
  retainProvider?: boolean;
  discovery?: unknown;
  failedPath?: string;
  malformedPath?: string;
  oversizedPath?: string;
  redirectPath?: string;
  cleanupFailure?: boolean;
}
function fixture(options: FixtureOptions = {}) {
  let connection = structuredClone(options.connection ?? MANAGED);
  let active: string | null = null;
  let sessions = 0;
  const calls: Call[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname + url.search;
      const rawBody = await request.text();
      const body: unknown = rawBody ? JSON.parse(rawBody) : undefined;
      calls.push({
        path,
        method: request.method,
        body,
        cookie: request.headers.get('cookie') ?? '',
      });
      expect(request.headers.get('origin')).toBe(INPUT.origin);
      if (options.redirectPath === path)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.example.org/collect' },
        });
      if (options.failedPath === path)
        return Response.json({ error: INPUT.password }, { status: 503 });
      if (options.malformedPath === path) return new Response(INPUT.password);
      if (options.oversizedPath === path)
        return Response.json({ secret: INPUT.password.repeat(100000) });
      if (
        path === '/api/auth/sign-in/email' ||
        path === '/api/auth/sign-up/email'
      ) {
        const status = path.includes('sign-up')
          ? (options.signupStatus ?? 200)
          : options.account &&
              String((body as { email?: string }).email).toLowerCase() !==
                options.account.email
            ? 401
            : (options.loginStatus ?? 200);
        const headers = new Headers();
        if (!options.noCookie && status === 200) {
          sessions++;
          headers.append(
            'set-cookie',
            `session=synthetic-${sessions}; HttpOnly; Path=/`,
          );
          headers.append(
            'set-cookie',
            'session_data=synthetic-data; HttpOnly; Path=/',
          );
        }
        return Response.json(
          {
            twoFactorRedirect: options.challenge ?? false,
            ...(options.enrollRequired ? { enrollRequired: true } : {}),
            error: status === 200 ? undefined : INPUT.password,
          },
          { status, headers },
        );
      }
      if (path === '/api/auth/get-session')
        return Response.json(
          active && options.selectedSession !== undefined
            ? options.selectedSession
            : options.session !== undefined
              ? options.session
              : {
                  user: {
                    id: 'native-user',
                    email: options.account?.email ?? INPUT.email.toUpperCase(),
                  },
                  session: {
                    userId: 'native-user',
                    activeOrganizationId: active,
                  },
                },
        );
      if (path === '/api/auth/organization/list')
        return Response.json(
          options.organizations ?? [{ id: 'org-example', slug: INPUT.slug }],
        );
      if (path === '/api/auth/organization/create')
        return Response.json(
          options.createdOrganization ?? {
            id: 'org-example',
            slug: INPUT.slug,
          },
        );
      if (path === '/api/auth/organization/set-active') {
        active = 'org-example';
        return Response.json(
          { id: active },
          { headers: { 'set-cookie': 'session_data=selected-data; Path=/' } },
        );
      }
      if (path === '/api/app/sso/config?orgId=org-example') {
        if (request.method === 'DELETE' && !options.retainProvider)
          connection = structuredClone(ABSENT);
        return Response.json(
          request.method === 'DELETE' ? { ok: true } : connection,
        );
      }
      if (path === '/api/app/sso/config/oidc?orgId=org-example') {
        connection = structuredClone(MANAGED);
        return Response.json({ ok: true });
      }
      if (path === '/api/app/sso/discovery/configured')
        return Response.json(
          options.discovery ?? { enabled: connection.enabled, multiple: false },
        );
      if (path === '/api/app/identity/clients?orgId=org-example')
        return Response.json({ clients: options.nativeClients ?? [] });
      if (path === '/api/app/members?orgId=org-example' && options.members) {
        if (request.method === 'POST' && !options.ignoreMemberWrites) {
          const added = body as { userId: string; role: string };
          options.members.push({
            id: `member-${added.userId}`,
            organizationId: 'org-example',
            ...added,
          });
          return Response.json({ memberId: `member-${added.userId}` });
        }
        return Response.json({ members: options.members });
      }
      // Like the native door: the organization-scope check guards the
      // by-member routes too, so a call without `orgId` is not served.
      const role = path.match(
        /^\/api\/app\/members\/([^/?]+)\/role\?orgId=org-example$/,
      );
      if (role && request.method === 'POST' && options.members) {
        const member = options.members.find(
          (value) => value.id === decodeURIComponent(role[1]!),
        );
        if (member && !options.ignoreMemberWrites)
          member.role = (body as { role: string }).role;
        return Response.json({ ok: true });
      }
      if (path === '/api/auth/sign-out')
        return Response.json(
          { success: !options.cleanupFailure },
          { status: options.cleanupFailure ? 503 : 200 },
        );
      return Response.json(
        { error: 'Unexpected fixture route' },
        { status: 404 },
      );
    },
  });
  const fetchImpl: NonNullable<InstanceOptions['fetchImpl']> = async (
    url,
    init,
  ) => {
    expect(new URL(url).origin).toBe('http://127.0.0.1:3005');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
    const target = new URL(url);
    target.port = String(server.port);
    return fetch(target, init);
  };
  return { calls, fetchImpl, stop: () => server.stop(true) };
}
async function withFixture<T>(
  options: FixtureOptions,
  body: (f: ReturnType<typeof fixture>) => Promise<T>,
) {
  const f = fixture(options);
  try {
    return await body(f);
  } finally {
    await f.stop();
  }
}
const writes = (calls: Call[]) =>
  calls.filter((call) => ['PUT', 'DELETE'].includes(call.method));

const PORTAL = {
  key: 'example-portal',
  name: 'Example portal',
  clientId: 'existing-portal-client',
  redirectUris: ['https://portal.example.org/oauth/callback'],
};
function reviewedBundle() {
  return deploymentBundleSchema.parse({
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision: 'a'.repeat(40), path: 'cli/tale' },
    spec: {
      schemaVersion: 1,
      name: 'example-native',
      stateDirectory: join(tmpdir(), 'example-native'),
      composeProject: 'example-native',
      runtime: { revision: 'b'.repeat(40) },
      origin: INPUT.origin,
      tlsMode: 'external',
      identity: {
        email: INPUT.email,
        password: { env: 'EXAMPLE_OPERATOR_PASSWORD' },
        slug: INPUT.slug,
        name: INPUT.name,
        ssoEnabled: false,
        nativeClients: [PORTAL],
      },
    },
    // The bundle verifier owns byte inventory. These tests pin the additional
    // public identity admission that happens before any login request.
    files: ['cli/tale', 'runtime/runtime.json', 'runtime/compose.yml'].map(
      (path) => ({
        path,
        sha256: 'c'.repeat(64),
        bytes: 1,
        executable: path === 'cli/tale',
      }),
    ),
  });
}

describe('reviewed deployment identity admission', () => {
  test('email attestation must match the reviewed fresh declaration before login', () => {
    const bundle = reviewedBundle();
    bundle.spec.identity!.bootstrap = 'fresh';
    const raw = {
      ...INPUT,
      ssoEnabled: false,
      bootstrap: 'fresh',
      emailVerification: 'operator-attested',
      nativeClients: [PORTAL],
    };
    const input = parsePrivateInstanceJson(JSON.stringify(raw));
    expect(() => verifyProvisionIdentity(bundle, input)).toThrow('differs');
    bundle.spec.identity!.emailVerification = 'operator-attested';
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
    expect(() =>
      verifyProvisionIdentity(bundle, {
        ...input,
        emailVerification: undefined,
      }),
    ).toThrow('differs');
    expect(() =>
      parsePrivateInstanceJson(
        JSON.stringify({ ...raw, bootstrap: undefined }),
      ),
    ).toThrow('input');
  });
  test('accepts exact public fields and case-insensitive email without reading credentials from the bundle', () => {
    const bundle = reviewedBundle();
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        email: INPUT.email.toUpperCase(),
        ssoEnabled: false,
        nativeClients: [PORTAL],
      }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
    expect(JSON.stringify(bundle)).not.toContain(INPUT.password);
  });

  test.each([
    { bootstrap: 'fresh' },
    { origin: 'https://other-native.example.org' },
    { slug: 'another-team' },
    { name: 'Another team' },
    { email: 'another-operator@example.org' },
    { ...ENTRA, ssoEnabled: true },
    { nativeClients: [] },
    { nativeClients: [{ ...PORTAL, key: 'another-portal' }] },
    { nativeClients: [{ ...PORTAL, name: 'Another portal' }] },
    { nativeClients: [{ ...PORTAL, clientId: 'another-client' }] },
    {
      nativeClients: [
        { ...PORTAL, redirectUris: ['https://other.example.org/callback'] },
      ],
    },
  ])('refuses public identity drift before authentication', (change) => {
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        ssoEnabled: false,
        nativeClients: [PORTAL],
        ...change,
      }),
    );
    expect(() => verifyProvisionIdentity(reviewedBundle(), input)).toThrow(
      'differs from',
    );
  });

  test('requires a declared bundle identity', () => {
    const bundle = reviewedBundle();
    delete bundle.spec.identity;
    const input = parsePrivateInstanceJson(
      JSON.stringify({ ...INPUT, ssoEnabled: false }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).toThrow(
      'identity differs',
    );
  });

  test('uses resolved private values for explicitly declared environment references', () => {
    const bundle = reviewedBundle();
    bundle.spec.identity = {
      email: { env: 'EXAMPLE_OPERATOR_EMAIL' },
      password: { env: 'EXAMPLE_OPERATOR_PASSWORD' },
      slug: INPUT.slug,
      name: INPUT.name,
      ssoEnabled: false,
      nativeClients: [
        { ...PORTAL, clientId: { env: 'EXAMPLE_NATIVE_CLIENT_ID' } },
      ],
    };
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        email: 'resolved-operator@example.org',
        ssoEnabled: false,
        nativeClients: [{ ...PORTAL, clientId: 'resolved-existing-client' }],
      }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
  });
});

describe('native instance provisioning over real local HTTP', () => {
  const testPosix = test.skipIf(process.platform === 'win32');
  testPosix(
    'origin migration preflights every retained binding and resumes partially migrated journals',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-origin-migration-all-'),
      );
      const oldOrigin = 'https://old.example.org';
      const client = intentSchema.parse({
        schemaVersion: 1,
        phase: 'ready',
        origin: oldOrigin,
        organizationId: 'org-example',
        operatorUserId: 'native-user',
        credentials: {
          clientId: 'retained-client',
          clientSecret: 'a'.repeat(43),
        },
        body: {
          client_name: PORTAL.name,
          software_id: PORTAL.key,
          redirect_uris: PORTAL.redirectUris,
          scope: 'openid profile email tale:organization',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          type: 'web',
          require_pkce: true,
          skip_consent: false,
          metadata: { taleOrganizationId: 'org-example' },
        },
      });
      const attestation = {
        schemaVersion: 1,
        phase: 'ready',
        origin: oldOrigin,
        method: 'operator-attested',
        userId: 'native-user',
        email: INPUT.email,
      };
      const bootstrap = {
        schemaVersion: 1,
        phase: 'ready',
        origin: oldOrigin,
        email: INPUT.email,
        slug: INPUT.slug,
        name: INPUT.name,
        userId: 'native-user',
        organizationId: 'org-example',
        emailVerification: 'operator-attested',
      };
      const input = {
        ...INPUT,
        ssoEnabled: false,
        bootstrap: 'fresh',
        emailVerification: 'operator-attested',
        migrateOriginFrom: oldOrigin,
        nativeClients: [
          {
            key: PORTAL.key,
            name: PORTAL.name,
            managed: true,
            redirectUris: PORTAL.redirectUris,
          },
        ],
      };
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const clientFile = join(
        stateDirectory,
        `private/client-${PORTAL.key}.json`,
      );
      const attestationFile = join(
        stateDirectory,
        'private/email-attestation.json',
      );
      try {
        writeProvisionState(bootstrapFile, bootstrap);
        writeProvisionState(clientFile, client);
        writeProvisionState(attestationFile, attestation);
        await withFixture(
          {
            connection: ABSENT,
            nativeClients: [
              {
                ...client.body,
                client_id: client.credentials.clientId,
                disabled: false,
                taleOrganizationId: client.organizationId,
              },
            ],
          },
          async (f) => {
            const options: InstanceOptions = {
              stateDirectory,
              fetchImpl: f.fetchImpl,
              managedClients: {
                create: async () => {
                  throw Error('Migration cannot create a client');
                },
                verify: async (credentials) => {
                  expect(credentials).toEqual(client.credentials);
                },
              },
              emailAttestation: async (args) => {
                expect(args.migrateOriginFrom).toBe(oldOrigin);
                return {
                  method: 'operator-attested',
                  userId: args.userId,
                  email: args.email,
                  emailVerified: true,
                  receipt: writeProvisionState(attestationFile, {
                    ...attestation,
                    origin: INPUT.origin,
                  }),
                };
              },
            };
            for (const change of [
              { origin: 'https://foreign.example.org' },
              { phase: 'pending' },
              { organizationId: 'foreign-org' },
              { operatorUserId: 'foreign-user' },
              { body: { ...client.body, software_id: 'foreign-key' } },
              {
                body: {
                  ...client.body,
                  metadata: { taleOrganizationId: 'foreign-org' },
                },
              },
            ]) {
              writeProvisionState(clientFile, { ...client, ...change });
              await expect(configureInstance(input, options)).rejects.toThrow(
                'retained native clients',
              );
              expect(f.calls).toHaveLength(0);
            }
            writeProvisionState(clientFile, client);
            for (const change of [
              { origin: 'https://foreign.example.org' },
              { phase: 'pending' },
              { userId: 'foreign-user' },
              { email: 'foreign@example.org' },
            ]) {
              writeProvisionState(attestationFile, {
                ...attestation,
                ...change,
              });
              await expect(configureInstance(input, options)).rejects.toThrow(
                'retained operator attestation',
              );
              expect(f.calls).toHaveLength(0);
            }
            writeProvisionState(attestationFile, attestation);
            await expect(
              configureInstance(input, {
                ...options,
                provision: async () => {
                  throw Error('late failure');
                },
              }),
            ).rejects.toThrow('provisioning failed');
            expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toEqual(
              bootstrap,
            );
            expect(JSON.parse(readFileSync(clientFile, 'utf8'))).toEqual({
              ...client,
              origin: INPUT.origin,
            });
            expect(JSON.parse(readFileSync(attestationFile, 'utf8'))).toEqual({
              ...attestation,
              origin: INPUT.origin,
            });
            const result = await configureInstance(input, options);
            expect(result).toMatchObject({
              userId: bootstrap.userId,
              organizationId: bootstrap.organizationId,
            });
            expect(result.nativeClients[0]?.clientId).toBe(
              client.credentials.clientId,
            );
            expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toEqual({
              ...bootstrap,
              origin: INPUT.origin,
            });
            expect(
              f.calls.some((call) =>
                /sign-up|organization\/create/.test(call.path),
              ),
            ).toBe(false);
            expect(writes(f.calls)).toHaveLength(0);
            // Reread must also refuse an identity swapped after preflight.
            writeProvisionState(bootstrapFile, bootstrap);
            await expect(
              configureInstance(input, {
                ...options,
                provision: async () => {
                  writeProvisionState(bootstrapFile, {
                    ...bootstrap,
                    userId: 'foreign-user',
                  });
                },
              }),
            ).rejects.toThrow('changed during origin migration');
            expect(JSON.parse(readFileSync(bootstrapFile, 'utf8')).userId).toBe(
              'foreign-user',
            );
          },
        );
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );
  // Only fresh bootstrap needs the POSIX intent store. The public managed
  // command refuses Windows; exact-ID HTTP and preflight tests remain portable.

  testPosix(
    'origin migration preserves the existing user and organization and replays without writes',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-origin-migration-'),
      );
      const input = {
        ...INPUT,
        bootstrap: 'fresh' as const,
        ssoEnabled: false,
      };
      try {
        await withFixture({ connection: ABSENT }, async (f) => {
          const options = { stateDirectory, fetchImpl: f.fetchImpl };
          const first = await configureInstance(input, options);
          const file = join(stateDirectory, 'private/bootstrap.json');
          const before = JSON.parse(readFileSync(file, 'utf8'));
          const old = { ...before, origin: 'https://old.example.org' };
          writeProvisionState(file, old);
          for (const migrateOriginFrom of [
            undefined,
            'https://wrong.example.org',
          ]) {
            f.calls.length = 0;
            await expect(
              configureInstance({ ...input, migrateOriginFrom }, options),
            ).rejects.toThrow('intent differs');
            expect(f.calls).toHaveLength(0);
          }
          writeProvisionState(file, { ...old, phase: 'pending' });
          await expect(
            configureInstance(
              { ...input, migrateOriginFrom: old.origin },
              options,
            ),
          ).rejects.toThrow('intent differs');
          writeProvisionState(file, old);
          const target = { ...input, migrateOriginFrom: old.origin };
          // A failure after authentication retains the source journal for replay.
          await expect(
            configureInstance(target, {
              ...options,
              provision: async () => {
                throw Error('synthetic failure');
              },
            }),
          ).rejects.toThrow('provisioning failed');
          expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(old);
          f.calls.length = 0;
          expect(await configureInstance(target, options)).toEqual(first);
          expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(before);
          expect(
            f.calls.some((call) =>
              /sign-up|organization\/create/.test(call.path),
            ),
          ).toBe(false);
          expect(writes(f.calls)).toHaveLength(0);
          const bytes = readFileSync(file);
          await configureInstance(target, options);
          expect(readFileSync(file)).toEqual(bytes);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'origin migration refuses incomplete identity or missing client journals before authentication',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-origin-migration-refusal-'),
      );
      const input = {
        ...INPUT,
        bootstrap: 'fresh' as const,
        ssoEnabled: false,
      };
      try {
        await withFixture({ connection: ABSENT }, async (f) => {
          const options = { stateDirectory, fetchImpl: f.fetchImpl };
          const target = {
            ...input,
            migrateOriginFrom: 'https://old.example.org',
          };
          await expect(configureInstance(target, options)).rejects.toThrow(
            'completed retained identity',
          );
          expect(f.calls).toHaveLength(0);
          await configureInstance(input, options);
          const file = join(stateDirectory, 'private/bootstrap.json');
          const before = JSON.parse(readFileSync(file, 'utf8'));
          writeProvisionState(file, {
            ...before,
            origin: target.migrateOriginFrom,
          });
          f.calls.length = 0;
          const client = {
            key: PORTAL.key,
            name: PORTAL.name,
            redirectUris: PORTAL.redirectUris,
            managed: true,
          };
          await expect(
            configureInstance({ ...target, nativeClients: [client] }, options),
          ).rejects.toThrow('retained native clients');
          expect(f.calls).toHaveLength(0);
          writeProvisionState(file, {
            ...before,
            origin: target.migrateOriginFrom,
            emailVerification: 'operator-attested',
          });
          await expect(
            configureInstance(
              { ...target, emailVerification: 'operator-attested' },
              {
                ...options,
                emailAttestation: async () => {
                  throw Error('Must not be called');
                },
              },
            ),
          ).rejects.toThrow('retained operator attestation');
          expect(f.calls).toHaveLength(0);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'explicit fresh local bootstrap creates its account/org once and retains native identities across replay',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-fresh-bootstrap-'),
      );
      const input = { ...INPUT, ssoEnabled: false, bootstrap: 'fresh' };
      try {
        const first = await withFixture(
          { loginStatus: 401, organizations: [], connection: ABSENT },
          async (f) => {
            const result = await configureInstance(input, {
              fetchImpl: f.fetchImpl,
              stateDirectory,
            });
            expect(
              f.calls.filter((call) => call.path.includes('sign-up')),
            ).toHaveLength(1);
            expect(
              f.calls.filter((call) =>
                call.path.includes('organization/create'),
              ),
            ).toHaveLength(1);
            return result;
          },
        );
        const file = join(stateDirectory, 'private/bootstrap.json');
        const retained = readFileSync(file);
        expect(JSON.parse(retained.toString())).toMatchObject({
          phase: 'ready',
          userId: first.userId,
          organizationId: first.organizationId,
        });
        expect(retained.includes(INPUT.password)).toBe(false);
        await withFixture({ connection: ABSENT }, async (f) => {
          expect(
            await configureInstance(input, {
              fetchImpl: f.fetchImpl,
              stateDirectory,
            }),
          ).toEqual(first);
          expect(
            f.calls.some((call) =>
              /sign-up|organization\/create/.test(call.path),
            ),
          ).toBe(false);
        });
        expect(readFileSync(file)).toEqual(retained);
        for (const options of [
          { loginStatus: 401 },
          { organizations: [] },
          {
            session: {
              user: { id: 'replacement-user', email: INPUT.email },
              session: { userId: 'replacement-user' },
            },
          },
        ])
          await withFixture({ ...options, connection: ABSENT }, async (f) => {
            await expect(
              configureInstance(input, {
                fetchImpl: f.fetchImpl,
                stateDirectory,
              }),
            ).rejects.toThrow();
            expect(
              f.calls.some((call) =>
                /sign-up|organization\/create/.test(call.path),
              ),
            ).toBe(false);
          });
        expect(readFileSync(file)).toEqual(retained);
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'fresh organization response loss retains the verified account and recovers by slug/session readback',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-fresh-bootstrap-loss-'),
      );
      const input = { ...INPUT, ssoEnabled: false, bootstrap: 'fresh' };
      try {
        await withFixture(
          {
            organizations: [],
            failedPath: '/api/auth/organization/create',
            connection: ABSENT,
          },
          async (f) => {
            await expect(
              configureInstance(input, {
                fetchImpl: f.fetchImpl,
                stateDirectory,
              }),
            ).rejects.toThrow('Organization bootstrap');
          },
        );
        const pending = JSON.parse(
          readFileSync(join(stateDirectory, 'private/bootstrap.json'), 'utf8'),
        );
        expect(pending).toMatchObject({
          phase: 'pending',
          userId: 'native-user',
        });
        await withFixture(
          { organizations: [], connection: ABSENT },
          async (f) => {
            await expect(
              configureInstance(input, {
                fetchImpl: f.fetchImpl,
                stateDirectory,
              }),
            ).rejects.toThrow('uncertain');
            expect(
              f.calls.some((call) => call.path.includes('organization/create')),
            ).toBe(false);
          },
        );
        await withFixture({ connection: ABSENT }, async (f) => {
          const result = await configureInstance(input, {
            fetchImpl: f.fetchImpl,
            stateDirectory,
          });
          expect(result.userId).toBe(pending.userId);
          expect(
            f.calls.some((call) =>
              /sign-up|organization\/create/.test(call.path),
            ),
          ).toBe(false);
        });
        await withFixture({ connection: ABSENT }, async (f) => {
          await expect(
            configureInstance(
              { ...input, slug: 'other-team' },
              { fetchImpl: f.fetchImpl, stateDirectory },
            ),
          ).rejects.toThrow('intent differs');
          expect(f.calls).toEqual([]);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'an uncertain initial account request cannot create again without authenticated readback',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-fresh-signup-loss-'),
      );
      const input = { ...INPUT, ssoEnabled: false, bootstrap: 'fresh' };
      try {
        await withFixture(
          { loginStatus: 401, signupStatus: 503 },
          async (f) => {
            await expect(
              configureInstance(input, {
                fetchImpl: f.fetchImpl,
                stateDirectory,
              }),
            ).rejects.toThrow();
            expect(
              f.calls.filter((call) => call.path.includes('sign-up')),
            ).toHaveLength(1);
          },
        );
        const file = join(stateDirectory, 'private/bootstrap.json');
        const bytes = readFileSync(file);
        expect(JSON.parse(bytes.toString()).signupAttempted).toBe(true);
        await withFixture({ loginStatus: 401 }, async (f) => {
          await expect(
            configureInstance(input, {
              fetchImpl: f.fetchImpl,
              stateDirectory,
            }),
          ).rejects.toThrow('uncertain');
          expect(f.calls.some((call) => call.path.includes('sign-up'))).toBe(
            false,
          );
        });
        expect(readFileSync(file)).toEqual(bytes);
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  test('fresh admission requires private state and exact fresh/client mode before authentication', async () => {
    await withFixture({}, async (f) => {
      await expect(
        configureInstance(
          { ...INPUT, ssoEnabled: false, bootstrap: 'fresh' },
          { fetchImpl: f.fetchImpl },
        ),
      ).rejects.toThrow('private managed');
      expect(f.calls).toEqual([]);
    });
    const bundle = reviewedBundle();
    const managed = {
      key: PORTAL.key,
      name: PORTAL.name,
      redirectUris: PORTAL.redirectUris,
      managed: true as const,
    };
    bundle.spec.identity!.bootstrap = 'fresh';
    bundle.spec.identity!.migrateOriginFrom = 'https://old.example.org';
    bundle.spec.identity!.nativeClients = [managed];
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        ssoEnabled: false,
        bootstrap: 'fresh',
        migrateOriginFrom: 'https://old.example.org',
        nativeClients: [managed],
      }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
    for (const migrateOriginFrom of [undefined, 'https://wrong.example.org'])
      expect(() =>
        verifyProvisionIdentity(bundle, { ...input, migrateOriginFrom }),
      ).toThrow('differs');
    expect(() =>
      verifyProvisionIdentity(bundle, { ...input, nativeClients: [PORTAL] }),
    ).toThrow('differs');
    expect(() =>
      verifyProvisionIdentity(bundle, { ...input, bootstrap: undefined }),
    ).toThrow('differs');
  });

  testPosix(
    'fresh operator attestation binds the authenticated pending account before organization provisioning',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-operator-attestation-'),
      );
      const input = {
        ...INPUT,
        ssoEnabled: false,
        bootstrap: 'fresh',
        emailVerification: 'operator-attested',
      };
      try {
        await withFixture({ connection: ABSENT }, async (f) => {
          await expect(
            configureInstance(input, {
              fetchImpl: f.fetchImpl,
              stateDirectory,
            }),
          ).rejects.toThrow('private managed native');
          expect(f.calls).toEqual([]);
          let attestations = 0;
          const emailAttestation: NonNullable<
            InstanceOptions['emailAttestation']
          > = async (args) => {
            attestations++;
            expect(args).toMatchObject({
              userId: 'native-user',
              email: INPUT.email,
              stateDirectory,
            });
            expect(args.headers.get('cookie')).toContain('synthetic-');
            const bootstrap = JSON.parse(
              readFileSync(
                join(stateDirectory, 'private/bootstrap.json'),
                'utf8',
              ),
            );
            expect(bootstrap).toMatchObject({
              phase: 'pending',
              userId: 'native-user',
              email: INPUT.email,
              emailVerification: 'operator-attested',
            });
            expect(
              f.calls.some((call) => call.path.includes('organization/')),
            ).toBe(false);
            return {
              method: 'operator-attested',
              userId: args.userId,
              email: args.email,
              emailVerified: true,
              receipt: {
                path: join(stateDirectory, 'private/email-attestation.json'),
                sha256: 'a'.repeat(64),
              },
            };
          };
          const result = await configureInstance(input, {
            fetchImpl: f.fetchImpl,
            stateDirectory,
            emailAttestation,
          });
          expect(attestations).toBe(1);
          expect(result.emailVerification).toMatchObject({
            userId: result.userId,
            email: INPUT.email,
            emailVerified: true,
          });
          expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
          expect(
            f.calls.some((call) => call.path.includes('verify-email')),
          ).toBe(false);
        });
      } finally {
        rmSync(stateDirectory, { force: true, recursive: true });
      }
    },
  );

  test('removes managed Entra once, proves the selected session and preserves partial cookie refresh', async () =>
    withFixture({}, async (f) => {
      const input = { ...INPUT, ssoEnabled: false };
      const first = await configureInstance(input, { fetchImpl: f.fetchImpl });
      await configureInstance(input, { fetchImpl: f.fetchImpl });
      expect(first).toEqual({
        organizationId: 'org-example',
        organizationSlug: INPUT.slug,
        userId: 'native-user',
        ssoEnabled: false,
        nativeClients: [],
      });
      expect(writes(f.calls)).toHaveLength(1);
      expect(
        f.calls.filter((call) => call.path === '/api/auth/sign-out'),
      ).toHaveLength(2);
      expect(
        f.calls.find((call) => call.path.includes('/sso/config'))?.cookie,
      ).toContain('session=synthetic-1');
      expect(
        f.calls.find((call) => call.path.includes('/sso/config'))?.cookie,
      ).toContain('session_data=selected-data');
      expect(JSON.stringify(first)).not.toContain('private');
    }));

  test('retains Entra first boot through native signup and organization creation', async () =>
    withFixture({ loginStatus: 401, organizations: [] }, async (f) => {
      expect(
        (
          await configureInstance(
            { ...INPUT, ...ENTRA },
            { fetchImpl: f.fetchImpl },
          )
        ).ssoEnabled,
      ).toBe(true);
      expect(
        f.calls.filter((call) => call.path === '/api/auth/sign-up/email'),
      ).toHaveLength(1);
      expect(
        f.calls.filter((call) => call.path === '/api/auth/organization/create'),
      ).toHaveLength(1);
      expect(writes(f.calls)[0]?.body).toMatchObject({
        providerId: 'entra-id',
        clientSecret: ENTRA.clientSecret,
        pkce: true,
        defaultRole: 'member',
        autoProvisionRole: false,
      });
    }));

  test('disabled mode ignores old provider credentials', async () =>
    withFixture({ connection: ABSENT }, async (f) => {
      await configureInstance(
        { ...INPUT, ...ENTRA, ssoEnabled: false },
        { fetchImpl: f.fetchImpl },
      );
      expect(writes(f.calls)).toHaveLength(0);
      expect(JSON.stringify(f.calls)).not.toContain(ENTRA.clientSecret);
    }));

  test('wrong local password never creates a replacement account or organization', async () =>
    withFixture({ loginStatus: 401 }, async (f) => {
      await expect(
        configureInstance(
          { ...INPUT, ssoEnabled: false },
          { fetchImpl: f.fetchImpl },
        ),
      ).rejects.toThrow('Administrator authentication failed (HTTP 401)');
      expect(f.calls.map((call) => call.path)).toEqual([
        '/api/auth/sign-in/email',
      ]);
    }));

  test.each(
    [
      null,
      [],
      {
        user: { id: 'native-user', email: 'different@example.org' },
        session: { userId: 'native-user' },
      },
      { user: { id: 'native-user', email: INPUT.email } },
      {
        user: { id: 'native-user', email: INPUT.email },
        session: { userId: 'different-user' },
      },
    ].map((session) => ({ session })),
  )(
    'refuses an unproven session before privileged writes',
    async ({ session }) =>
      withFixture({ session }, async (f) => {
        await expect(
          configureInstance(
            { ...INPUT, ssoEnabled: false },
            { fetchImpl: f.fetchImpl },
          ),
        ).rejects.toThrow('Administrator session');
        expect(writes(f.calls)).toHaveLength(0);
        expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
      }),
  );

  test('refuses selected-organization drift before settings and callback writes', async () =>
    withFixture(
      {
        selectedSession: {
          user: { id: 'native-user', email: INPUT.email },
          session: {
            userId: 'native-user',
            activeOrganizationId: 'foreign-org',
          },
        },
      },
      async (f) => {
        let callback = false;
        await expect(
          configureInstance(
            { ...INPUT, ssoEnabled: false },
            {
              fetchImpl: f.fetchImpl,
              provision: async () => {
                callback = true;
              },
            },
          ),
        ).rejects.toThrow('Administrator session');
        expect(callback).toBe(false);
        expect(writes(f.calls)).toHaveLength(0);
        expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
      },
    ));

  test.each([{ challenge: true }, { noCookie: true }])(
    'refuses incomplete login state %j',
    async (options) =>
      withFixture(options, async (f) => {
        await expect(
          configureInstance(
            { ...INPUT, ssoEnabled: false },
            { fetchImpl: f.fetchImpl },
          ),
        ).rejects.toThrow();
        expect(writes(f.calls)).toHaveLength(0);
        expect(f.calls.some((call) => call.path === '/api/auth/sign-out')).toBe(
          !options.noCookie,
        );
      }),
  );

  test.each(
    [
      [],
      [{ id: 'foreign-org', slug: 'other' }],
      [
        { id: 'one', slug: INPUT.slug },
        { id: 'two', slug: INPUT.slug },
      ],
    ].map((organizations) => ({ organizations })),
  )(
    'refuses missing or ambiguous existing organization',
    async ({ organizations }) =>
      withFixture({ organizations }, async (f) => {
        await expect(
          configureInstance(
            { ...INPUT, ssoEnabled: false },
            { fetchImpl: f.fetchImpl },
          ),
        ).rejects.toThrow('organization');
        expect(writes(f.calls)).toHaveLength(0);
        expect(
          f.calls.some((call) => call.path === '/api/auth/organization/create'),
        ).toBe(false);
      }),
  );

  test.each([
    { ...MANAGED, protocol: 'saml' },
    { ...MANAGED, displayName: 'Manual provider' },
    { ...MANAGED, oidc: { ...MANAGED.oidc, providerId: 'generic-oidc' } },
    {
      ...MANAGED,
      oidc: { ...MANAGED.oidc, issuer: 'https://unmanaged.example.org' },
    },
    { ...MANAGED, otherOrgsEnabled: true },
  ])('does not remove an unmanaged provider', async (connection) =>
    withFixture({ connection }, async (f) => {
      await expect(
        configureInstance(
          { ...INPUT, ssoEnabled: false },
          { fetchImpl: f.fetchImpl },
        ),
      ).rejects.toThrow('Entra');
      expect(writes(f.calls)).toHaveLength(0);
      expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
    }),
  );

  test.each([
    { retainProvider: true },
    { discovery: { enabled: true, multiple: false } },
    { failedPath: '/api/app/sso/config?orgId=org-example' },
    { malformedPath: '/api/app/sso/config?orgId=org-example' },
    { oversizedPath: '/api/app/sso/config?orgId=org-example' },
    { redirectPath: '/api/app/sso/config?orgId=org-example' },
  ])(
    'holds failed cleanup/invalid native responses without exposing private data',
    async (options) =>
      withFixture(options, async (f) => {
        const error = await configureInstance(
          { ...INPUT, ssoEnabled: false },
          { fetchImpl: f.fetchImpl },
        ).catch((value) => value);
        expect(error).toBeInstanceOf(Error);
        expect(JSON.stringify(error)).not.toContain(INPUT.password);
        expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
      }),
  );

  test('callback sees one proven scoped session; failure is redacted and signed out', async () =>
    withFixture({ connection: ABSENT }, async (f) => {
      let called = 0;
      const error = await configureInstance(
        { ...INPUT, ssoEnabled: false },
        {
          fetchImpl: f.fetchImpl,
          provision: async (context) => {
            called++;
            expect(context.organization.id).toBe('org-example');
            expect(context.user.id).toBe('native-user');
            expect(context.headers().get('cookie')).toContain('session=');
            expect('input' in context).toBe(false);
            await expect(
              context.request('https://untrusted.example.org/api/data'),
            ).rejects.toThrow('request path');
            throw new Error(ENTRA.clientSecret);
          },
        },
      ).catch((value) => value);
      expect(called).toBe(1);
      expect(error.message).toBe('Native configuration provisioning failed.');
      expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
    }));

  test('cleanup failure never reports provisioning success', async () =>
    withFixture({ connection: ABSENT, cleanupFailure: true }, async (f) => {
      await expect(
        configureInstance(
          { ...INPUT, ssoEnabled: false },
          { fetchImpl: f.fetchImpl },
        ),
      ).rejects.toThrow('session cleanup failed');
    }));

  test('network timeout errors cannot reflect credential-bearing messages', async () => {
    const error = await configureInstance(
      { ...INPUT, ssoEnabled: false },
      {
        fetchImpl: async (_url, init) => {
          expect(init.signal).toBeInstanceOf(AbortSignal);
          throw new Error(INPUT.password);
        },
      },
    ).catch((value) => value);
    expect(error.message).toBe(
      'Native provisioning request failed or timed out.',
    );
    expect(JSON.stringify(error)).not.toContain(INPUT.password);
  });
});

describe('private provisioning input', () => {
  test.each([
    'null',
    '[]',
    '"private"',
    '{"password":"synthetic-private',
    '{}',
  ])('rejects invalid JSON/input without reflecting it', (raw) => {
    expect(() => parsePrivateInstanceJson(raw)).toThrow(
      'Invalid native instance provisioning',
    );
  });
  test('bounds bytes before parsing', () => {
    expect(() =>
      parsePrivateInstanceJson(' '.repeat(PRIVATE_INPUT_LIMIT + 1)),
    ).toThrow('exceeds 64 KiB');
  });
  test.each([
    { ssoEnabled: 'false' },
    { origin: 'http://native.example.org' },
    { origin: 'https://private:secret@example.org' },
    { origin: 'https://native.example.org/path' },
    { origin: 'https://native.example.org/?secret=private' },
    { tenantId: '../invalid', ssoEnabled: true },
    { unknown: 'private' },
  ])('rejects invalid boundary before network %j', async (change) => {
    let called = false;
    await expect(
      configureInstance(
        { ...INPUT, ...ENTRA, ssoEnabled: false, ...change },
        {
          fetchImpl: async () => {
            called = true;
            return Response.json({});
          },
        },
      ),
    ).rejects.toThrow('input');
    expect(called).toBe(false);
  });
});

// The command's byte reader is independent of its Commander/process exit path.
// Compiled command orchestration has a separate subprocess lane.
describe('private stdin byte reader', () => {
  test('preserves a split UTF-8 credential without putting it in output', async () => {
    const { readPrivateProvisionInput } =
      await import('../../commands/deploy/provision');
    const bytes = Buffer.from(
      JSON.stringify({
        ...INPUT,
        password: 'synthetic-ä-private',
        ssoEnabled: false,
      }),
    );
    const split = bytes.indexOf(Buffer.from('ä')) + 1;
    async function* source() {
      yield bytes.subarray(0, split);
      yield bytes.subarray(split);
    }
    expect((await readPrivateProvisionInput(source())).password).toBe(
      'synthetic-ä-private',
    );
  });
  test('rejects oversized chunks before asking for the rest of stdin', async () => {
    const { readPrivateProvisionInput } =
      await import('../../commands/deploy/provision');
    let read = 0;
    async function* source() {
      read++;
      yield Buffer.alloc(PRIVATE_INPUT_LIMIT + 1);
      read++;
      yield Buffer.from(INPUT.password);
    }
    await expect(readPrivateProvisionInput(source())).rejects.toThrow(
      'exceeds 64 KiB',
    );
    expect(read).toBe(1);
  });
  test('rejects malformed UTF-8 rather than changing a credential', async () => {
    const { readPrivateProvisionInput } =
      await import('../../commands/deploy/provision');
    async function* source() {
      yield Buffer.from([0xff]);
    }
    await expect(readPrivateProvisionInput(source())).rejects.toThrow(
      'valid UTF-8',
    );
  });
  test('does not reflect a stream error or malformed JSON', async () => {
    const { readPrivateProvisionInput } =
      await import('../../commands/deploy/provision');
    async function* failed() {
      yield Buffer.from('{');
      throw new Error(INPUT.password);
    }
    const error = await readPrivateProvisionInput(failed()).catch(
      (value) => value,
    );
    expect(error.message).toBe(
      'Unable to read private native instance provisioning input.',
    );
    expect(JSON.stringify(error)).not.toContain(INPUT.password);
  });
});

const PREVIOUS = INPUT.email;
const DECLARED = 'deploy@example.org';
const BREAK_GLASS = 'break-glass@example.org';
const HASH = `${'a'.repeat(32)}:${'b'.repeat(128)}`;

describe('reviewed operator address, break-glass and two-factor declarations', () => {
  test('address migration and break-glass declarations must match the reviewed bundle before login', () => {
    const bundle = reviewedBundle();
    bundle.spec.identity!.bootstrap = 'fresh';
    bundle.spec.identity!.email = DECLARED;
    bundle.spec.identity!.migrateEmailFrom = PREVIOUS.toUpperCase();
    bundle.spec.identity!.breakGlass = {
      email: BREAK_GLASS,
      passwordHash: { env: 'EXAMPLE_BREAK_GLASS_HASH' },
    };
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        email: DECLARED,
        ssoEnabled: false,
        bootstrap: 'fresh',
        migrateEmailFrom: PREVIOUS,
        breakGlass: { email: BREAK_GLASS.toUpperCase(), passwordHash: HASH },
        nativeClients: [PORTAL],
      }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
    expect(JSON.stringify(bundle)).not.toContain(HASH);
    for (const change of [
      { migrateEmailFrom: undefined },
      { migrateEmailFrom: 'wrong@example.org' },
      { breakGlass: undefined },
      { breakGlass: { email: 'other@example.org', passwordHash: HASH } },
    ])
      expect(() =>
        verifyProvisionIdentity(bundle, { ...input, ...change }),
      ).toThrow('differs from the deployment bundle');
    bundle.spec.identity!.breakGlass = {
      email: { env: 'EXAMPLE_BREAK_GLASS_EMAIL' },
      passwordHash: { env: 'EXAMPLE_BREAK_GLASS_HASH' },
    };
    expect(() =>
      verifyProvisionIdentity(bundle, {
        ...input,
        breakGlass: { email: 'resolved@example.org', passwordHash: HASH },
      }),
    ).not.toThrow();
    delete bundle.spec.identity!.breakGlass;
    expect(() => verifyProvisionIdentity(bundle, input)).toThrow('differs');
  });

  test.each([
    { migrateEmailFrom: 'previous@example.org' },
    { bootstrap: 'fresh', migrateEmailFrom: INPUT.email.toUpperCase() },
    { breakGlass: { email: INPUT.email.toUpperCase(), passwordHash: HASH } },
    {
      bootstrap: 'fresh',
      migrateEmailFrom: 'previous@example.org',
      breakGlass: { email: 'PREVIOUS@example.org', passwordHash: HASH },
    },
    { breakGlass: { email: BREAK_GLASS, passwordHash: HASH.toUpperCase() } },
    { breakGlass: { email: BREAK_GLASS, passwordHash: `${HASH}\n` } },
    { breakGlass: { email: BREAK_GLASS, passwordHash: 'Plain!Password1' } },
    { breakGlass: { email: BREAK_GLASS } },
    { breakGlass: { email: BREAK_GLASS, passwordHash: HASH, password: 'x' } },
  ])(
    'refuses invalid address migration or break-glass input before the network %#',
    async (change) => {
      let called = false;
      const error = await configureInstance(
        { ...INPUT, ssoEnabled: false, ...change },
        {
          fetchImpl: async () => {
            called = true;
            return Response.json({});
          },
        },
      ).catch((value: unknown) => value);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe('Invalid native instance provisioning input.');
      expect(JSON.stringify(error)).not.toContain(HASH);
      expect(JSON.stringify(error)).not.toContain('Plain!Password1');
      expect(called).toBe(false);
    },
  );

  test.each([
    [
      { challenge: true, enrollRequired: true },
      'The deploy operator has no second factor and its two-factor enrolment grace period has ended; register a passkey for it.',
    ],
    [
      { challenge: true },
      'The deploy operator has TOTP enabled; a managed deploy signs in with its password alone, so the operator must hold a passkey and no TOTP.',
    ],
  ])(
    'names why an enforced two-factor policy stops the unattended sign-in %#',
    async (options, message) =>
      withFixture({ ...options, connection: ABSENT }, async (f) => {
        const error = await configureInstance(
          { ...INPUT, ssoEnabled: false },
          { fetchImpl: f.fetchImpl },
        ).catch((value: unknown) => value);
        if (!(error instanceof Error)) throw error;
        expect(error.message).toBe(message);
        expect(JSON.stringify(error)).not.toContain(INPUT.password);
        expect(writes(f.calls)).toHaveLength(0);
        expect(f.calls.map((call) => call.path)).toEqual([
          '/api/auth/sign-in/email',
          '/api/auth/sign-out',
        ]);
      }),
  );

  test('address migration and break-glass declarations require their private backend-local capabilities', async () =>
    withFixture({}, async (f) => {
      await expect(
        configureInstance(
          {
            ...INPUT,
            email: DECLARED,
            ssoEnabled: false,
            bootstrap: 'fresh',
            migrateEmailFrom: PREVIOUS,
          },
          { fetchImpl: f.fetchImpl, stateDirectory: tmpdir() },
        ),
      ).rejects.toThrow(
        'Operator address migration requires private managed native access.',
      );
      for (const options of [
        { fetchImpl: f.fetchImpl, breakGlassAccount: async () => undefined },
        { fetchImpl: f.fetchImpl, stateDirectory: tmpdir() },
      ])
        await expect(
          configureInstance(
            {
              ...INPUT,
              ssoEnabled: false,
              breakGlass: { email: BREAK_GLASS, passwordHash: HASH },
            },
            options as InstanceOptions,
          ),
        ).rejects.toThrow(
          'Break-glass administrator provisioning requires private managed native state.',
        );
      expect(f.calls).toEqual([]);
    }));
});

describe('operator address migration over real local HTTP', () => {
  const testPosix = test.skipIf(process.platform === 'win32');
  const retainedBootstrap = {
    schemaVersion: 1,
    phase: 'ready',
    origin: INPUT.origin,
    email: PREVIOUS,
    slug: INPUT.slug,
    name: INPUT.name,
    userId: 'native-user',
    organizationId: 'org-example',
  };
  const target = {
    ...INPUT,
    email: DECLARED,
    ssoEnabled: false,
    bootstrap: 'fresh' as const,
    migrateEmailFrom: PREVIOUS,
  };
  /** A native account whose address the backend-local capability moves. */
  function nativeAddress(account: { email: string }, bootstrapFile: string) {
    const events: string[] = [];
    let crash = false;
    const operatorAddress: OperatorAddress = {
      read: async (args) => {
        expect(args).toEqual({
          userId: 'native-user',
          email: DECLARED,
          migrateEmailFrom: PREVIOUS,
        });
        events.push(`read:${account.email}`);
        return { email: account.email };
      },
      rename: async (args) => {
        expect(args).toMatchObject({
          userId: 'native-user',
          email: DECLARED,
          migrateEmailFrom: PREVIOUS,
        });
        expect(args.headers.get('cookie')).toContain('session=synthetic-');
        // The journal marker precedes the native write.
        expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toMatchObject({
          email: PREVIOUS,
          migratingEmailFrom: PREVIOUS,
        });
        const renamed = account.email === PREVIOUS;
        if (renamed) {
          account.email = DECLARED;
          events.push('rename');
        }
        events.push('end-sessions');
        if (crash) {
          crash = false;
          throw externalDepError('Native operator address migration failed.');
        }
        return { renamed };
      },
    };
    return {
      events,
      operatorAddress,
      crashAfterRename: () => {
        crash = true;
      },
    };
  }
  const signIns = (calls: Call[]) =>
    calls
      .filter((call) => call.path === '/api/auth/sign-in/email')
      .map((call) => (call.body as { email: string }).email);

  testPosix(
    'renames the retained account once, signs in again at the declared address and replays harmlessly',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-address-migration-'),
      );
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const account = { email: PREVIOUS };
      const native = nativeAddress(account, bootstrapFile);
      try {
        writeProvisionState(bootstrapFile, retainedBootstrap);
        await withFixture({ connection: ABSENT, account }, async (f) => {
          const options = {
            stateDirectory,
            fetchImpl: f.fetchImpl,
            operatorAddress: native.operatorAddress,
          };
          const result = await configureInstance(target, options);
          expect(result).toMatchObject({
            userId: 'native-user',
            organizationId: 'org-example',
          });
          expect(native.events).toEqual([
            `read:${PREVIOUS}`,
            'rename',
            'end-sessions',
          ]);
          expect(signIns(f.calls)).toEqual([PREVIOUS, DECLARED]);
          expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toEqual({
            ...retainedBootstrap,
            email: DECLARED,
          });
          expect(
            f.calls.some((call) =>
              /sign-up|organization\/create/.test(call.path),
            ),
          ).toBe(false);
          expect(writes(f.calls)).toHaveLength(0);
          expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
          // Keeping the declaration after the migration stays harmless.
          const bytes = readFileSync(bootstrapFile);
          f.calls.length = 0;
          expect(await configureInstance(target, options)).toEqual(result);
          expect(native.events.slice(3)).toEqual([`read:${DECLARED}`]);
          expect(signIns(f.calls)).toEqual([DECLARED]);
          expect(readFileSync(bootstrapFile)).toEqual(bytes);
          const { migrateEmailFrom: _declared, ...completed } = target;
          expect(await configureInstance(completed, options)).toEqual(result);
          expect(native.events).toHaveLength(4);
          expect(readFileSync(bootstrapFile)).toEqual(bytes);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'an interrupted run after the rename resumes from its journal without a second rename',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-address-migration-resume-'),
      );
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const account = { email: PREVIOUS };
      const native = nativeAddress(account, bootstrapFile);
      try {
        writeProvisionState(bootstrapFile, retainedBootstrap);
        await withFixture({ connection: ABSENT, account }, async (f) => {
          const options = {
            stateDirectory,
            fetchImpl: f.fetchImpl,
            operatorAddress: native.operatorAddress,
          };
          native.crashAfterRename();
          await expect(configureInstance(target, options)).rejects.toThrow(
            'Native operator address migration failed.',
          );
          expect(account.email).toBe(DECLARED);
          expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toEqual({
            ...retainedBootstrap,
            migratingEmailFrom: PREVIOUS,
          });
          expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
          // Removing the declaration mid-migration holds for review.
          f.calls.length = 0;
          const { migrateEmailFrom: _declared, ...premature } = target;
          await expect(configureInstance(premature, options)).rejects.toThrow(
            'Fresh bootstrap intent differs from the configured identity.',
          );
          expect(f.calls).toEqual([]);
          const result = await configureInstance(target, options);
          expect(result.userId).toBe('native-user');
          expect(native.events).toEqual([
            `read:${PREVIOUS}`,
            'rename',
            'end-sessions',
            `read:${DECLARED}`,
            'end-sessions',
          ]);
          expect(signIns(f.calls)).toEqual([DECLARED, DECLARED]);
          expect(JSON.parse(readFileSync(bootstrapFile, 'utf8'))).toEqual({
            ...retainedBootstrap,
            email: DECLARED,
          });
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'refuses incomplete or foreign retained records and a foreign address holder before authentication',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-address-migration-refusal-'),
      );
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const attestationFile = join(
        stateDirectory,
        'private/email-attestation.json',
      );
      const account = { email: PREVIOUS };
      const native = nativeAddress(account, bootstrapFile);
      try {
        await withFixture({ connection: ABSENT, account }, async (f) => {
          const options = {
            stateDirectory,
            fetchImpl: f.fetchImpl,
            operatorAddress: native.operatorAddress,
          };
          await expect(configureInstance(target, options)).rejects.toThrow(
            'Operator address migration requires a completed retained identity.',
          );
          expect(existsSync(bootstrapFile)).toBe(false);
          const { organizationId: _missing, ...incomplete } = retainedBootstrap;
          writeProvisionState(bootstrapFile, {
            ...incomplete,
            phase: 'pending',
          });
          await expect(configureInstance(target, options)).rejects.toThrow(
            'Operator address migration requires a completed retained identity.',
          );
          for (const change of [
            { email: 'someone@example.org' },
            { migratingEmailFrom: 'someone@example.org' },
            { migratingEmailFrom: DECLARED },
          ]) {
            writeProvisionState(bootstrapFile, {
              ...retainedBootstrap,
              ...change,
            });
            await expect(configureInstance(target, options)).rejects.toThrow(
              'Fresh bootstrap intent differs from the configured identity.',
            );
          }
          const attested = {
            ...target,
            emailVerification: 'operator-attested' as const,
          };
          writeProvisionState(bootstrapFile, {
            ...retainedBootstrap,
            emailVerification: 'operator-attested',
          });
          const attestation = {
            schemaVersion: 1,
            phase: 'ready',
            origin: INPUT.origin,
            method: 'operator-attested',
            userId: 'native-user',
            email: PREVIOUS,
          };
          const attestedOptions = {
            ...options,
            emailAttestation: async () => {
              throw Error('Must not be called');
            },
          };
          await expect(
            configureInstance(attested, attestedOptions),
          ).rejects.toThrow(
            'Operator address migration requires the retained operator attestation.',
          );
          for (const change of [
            { phase: 'pending' },
            { userId: 'foreign-user' },
            { email: 'someone@example.org' },
          ]) {
            writeProvisionState(attestationFile, { ...attestation, ...change });
            await expect(
              configureInstance(attested, attestedOptions),
            ).rejects.toThrow(
              'Operator address migration requires the retained operator attestation.',
            );
          }
          expect(f.calls).toEqual([]);
          expect(native.events).toEqual([]);
          writeProvisionState(bootstrapFile, retainedBootstrap);
          const bytes = readFileSync(bootstrapFile);
          await expect(
            configureInstance(target, {
              ...options,
              operatorAddress: {
                ...native.operatorAddress,
                read: async () => {
                  throw preconditionError(
                    'Another account already holds the declared operator address.',
                  );
                },
              },
            }),
          ).rejects.toThrow(
            'Another account already holds the declared operator address.',
          );
          expect(f.calls).toEqual([]);
          expect(readFileSync(bootstrapFile)).toEqual(bytes);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'a refused sign-in at the previous address changes neither the account nor its journal',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-address-migration-two-factor-'),
      );
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const account = { email: PREVIOUS };
      const native = nativeAddress(account, bootstrapFile);
      try {
        writeProvisionState(bootstrapFile, retainedBootstrap);
        const bytes = readFileSync(bootstrapFile);
        await withFixture(
          { connection: ABSENT, account, challenge: true },
          async (f) => {
            await expect(
              configureInstance(target, {
                stateDirectory,
                fetchImpl: f.fetchImpl,
                operatorAddress: native.operatorAddress,
              }),
            ).rejects.toThrow('TOTP enabled');
            expect(native.events).toEqual([`read:${PREVIOUS}`]);
            expect(account.email).toBe(PREVIOUS);
            expect(readFileSync(bootstrapFile)).toEqual(bytes);
          },
        );
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'native client reconciliation keeps its operator binding across the rename',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-address-migration-clients-'),
      );
      const bootstrapFile = provisionStatePath(
        stateDirectory,
        'bootstrap.json',
        true,
      );
      const clientFile = join(
        stateDirectory,
        `private/client-${PORTAL.key}.json`,
      );
      const client = intentSchema.parse({
        schemaVersion: 1,
        phase: 'ready',
        origin: INPUT.origin,
        organizationId: 'org-example',
        operatorUserId: 'native-user',
        credentials: {
          clientId: 'retained-client',
          clientSecret: 'a'.repeat(43),
        },
        body: {
          client_name: PORTAL.name,
          software_id: PORTAL.key,
          redirect_uris: PORTAL.redirectUris,
          scope: 'openid profile email tale:organization',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          type: 'web',
          require_pkce: true,
          skip_consent: false,
          metadata: { taleOrganizationId: 'org-example' },
        },
      });
      const account = { email: PREVIOUS };
      const native = nativeAddress(account, bootstrapFile);
      try {
        writeProvisionState(bootstrapFile, retainedBootstrap);
        writeProvisionState(clientFile, client);
        const clientBytes = readFileSync(clientFile);
        let verified = 0;
        await withFixture(
          {
            connection: ABSENT,
            account,
            nativeClients: [
              {
                ...client.body,
                client_id: client.credentials.clientId,
                disabled: false,
                taleOrganizationId: client.organizationId,
              },
            ],
          },
          async (f) => {
            const result = await configureInstance(
              {
                ...target,
                nativeClients: [
                  {
                    key: PORTAL.key,
                    name: PORTAL.name,
                    managed: true,
                    redirectUris: PORTAL.redirectUris,
                  },
                ],
              },
              {
                stateDirectory,
                fetchImpl: f.fetchImpl,
                operatorAddress: native.operatorAddress,
                managedClients: {
                  create: async () => {
                    throw Error('A rename cannot create a client');
                  },
                  verify: async (credentials) => {
                    // Verified only after the renamed account signed in again.
                    expect(account.email).toBe(DECLARED);
                    expect(credentials).toEqual(client.credentials);
                    verified++;
                  },
                },
              },
            );
            expect(native.events).toContain('rename');
            expect(result.userId).toBe('native-user');
            expect(result.nativeClients).toEqual([
              {
                key: PORTAL.key,
                clientId: client.credentials.clientId,
                changed: false,
                credentials: {
                  path: clientFile,
                  sha256: expect.any(String),
                },
              },
            ]);
          },
        );
        expect(verified).toBe(2);
        expect(readFileSync(clientFile)).toEqual(clientBytes);
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );
});

describe('break-glass administrator over real local HTTP', () => {
  const testPosix = test.skipIf(process.platform === 'win32');
  const owner: Member = {
    id: 'member-operator',
    organizationId: 'org-example',
    userId: 'native-user',
    role: 'owner',
  };
  const declared = { email: BREAK_GLASS, passwordHash: HASH };
  const account = {
    userId: 'break-glass-user',
    email: BREAK_GLASS,
    created: true,
    credentialUpdated: false,
  };

  testPosix(
    'converges an administrator through the operator session and reports no secret',
    async () => {
      const stateDirectory = mkdtempSync(join(tmpdir(), 'tale-break-glass-'));
      const members = [owner];
      try {
        await withFixture({ connection: ABSENT, members }, async (f) => {
          const breakGlassAccount: BreakGlassAccount = async (args) => {
            expect(args).toMatchObject({
              operatorUserId: 'native-user',
              email: BREAK_GLASS.toUpperCase(),
              passwordHash: HASH,
              stateDirectory,
            });
            expect(args.headers.get('cookie')).toContain('session=synthetic-');
            // Only after the managed organization is selected.
            expect(
              f.calls.some(
                (call) => call.path === '/api/auth/organization/list',
              ),
            ).toBe(true);
            expect(
              f.calls.some((call) => call.path.startsWith('/api/app/')),
            ).toBe(false);
            return account;
          };
          const input = {
            ...INPUT,
            ssoEnabled: false,
            breakGlass: { ...declared, email: BREAK_GLASS.toUpperCase() },
          };
          const options = {
            stateDirectory,
            fetchImpl: f.fetchImpl,
            breakGlassAccount,
          };
          const result = await configureInstance(input, options);
          expect(result.breakGlass).toEqual(account);
          expect(JSON.stringify(result)).not.toContain(HASH);
          expect(
            f.calls
              .filter((call) => call.path.startsWith('/api/app/members'))
              .map((call) => [call.method, call.path, call.body]),
          ).toEqual([
            ['GET', '/api/app/members?orgId=org-example', undefined],
            [
              'POST',
              '/api/app/members?orgId=org-example',
              { userId: account.userId, role: 'admin' },
            ],
            ['GET', '/api/app/members?orgId=org-example', undefined],
          ]);
          expect(JSON.stringify(f.calls)).not.toContain(HASH);
          expect(members.at(-1)).toMatchObject({
            userId: account.userId,
            role: 'admin',
          });
          expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
          f.calls.length = 0;
          await configureInstance(input, options);
          expect(
            f.calls.filter((call) => call.path.startsWith('/api/app/members')),
          ).toHaveLength(1);
          f.calls.length = 0;
          for (const answer of [
            { ...account, userId: 'native-user' },
            { ...account, email: 'other@example.org' },
            { ...account, passwordHash: HASH },
          ]) {
            await expect(
              configureInstance(input, {
                ...options,
                breakGlassAccount: async () => answer as typeof account,
              }),
            ).rejects.toThrow(
              'Break-glass administrator differs from the declaration.',
            );
            expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
          }
          expect(
            f.calls.some((call) => call.path.startsWith('/api/app/members')),
          ).toBe(false);
        });
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );

  testPosix(
    'a membership that does not converge fails the deployment, and a foreign retained journal refuses before login',
    async () => {
      const stateDirectory = mkdtempSync(
        join(tmpdir(), 'tale-break-glass-refusal-'),
      );
      try {
        await withFixture(
          { connection: ABSENT, members: [owner], ignoreMemberWrites: true },
          async (f) => {
            const options = {
              stateDirectory,
              fetchImpl: f.fetchImpl,
              breakGlassAccount: async () => account,
            };
            const input = { ...INPUT, ssoEnabled: false, breakGlass: declared };
            await expect(configureInstance(input, options)).rejects.toThrow(
              'Break-glass administrator membership did not converge.',
            );
            expect(f.calls.at(-1)?.path).toBe('/api/auth/sign-out');
            const file = provisionStatePath(
              stateDirectory,
              'break-glass.json',
              true,
            );
            for (const change of [
              { email: 'other-break-glass@example.org' },
              { origin: 'https://foreign.example.org' },
            ]) {
              writeProvisionState(file, {
                schemaVersion: 1,
                phase: 'ready',
                origin: INPUT.origin,
                email: BREAK_GLASS,
                userId: account.userId,
                ...change,
              });
              f.calls.length = 0;
              await expect(configureInstance(input, options)).rejects.toThrow(
                'Retained break-glass administrator differs from the declared address.',
              );
              expect(f.calls).toEqual([]);
            }
          },
        );
      } finally {
        rmSync(stateDirectory, { recursive: true, force: true });
      }
    },
  );
});
