import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyProvisionIdentity } from '../../commands/deploy/provision';
import { deploymentBundleSchema } from './bundle';
import {
  configureInstance,
  parsePrivateInstanceJson,
  PRIVATE_INPUT_LIMIT,
  type InstanceOptions,
} from './identity';

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
interface FixtureOptions {
  loginStatus?: number;
  signupStatus?: number;
  challenge?: boolean;
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
                  user: { id: 'native-user', email: INPUT.email.toUpperCase() },
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
  // Only fresh bootstrap needs the POSIX intent store. The public managed
  // command refuses Windows; exact-ID HTTP and preflight tests remain portable.
  const testPosix = test.skipIf(process.platform === 'win32');

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
    bundle.spec.identity!.nativeClients = [managed];
    const input = parsePrivateInstanceJson(
      JSON.stringify({
        ...INPUT,
        ssoEnabled: false,
        bootstrap: 'fresh',
        nativeClients: [managed],
      }),
    );
    expect(() => verifyProvisionIdentity(bundle, input)).not.toThrow();
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
