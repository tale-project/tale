import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { provisionManagedBundle } from '../src/commands/deploy/provision';
import { writeDeploymentBundle } from '../src/lib/deployment/bundle';
import {
  configureInstance,
  parseInstanceInput,
} from '../src/lib/deployment/identity';
import { deploymentSpecSchema } from '../src/lib/deployment/model';
import { nativeDeploymentStateDirectory } from '../src/lib/deployment/provision-state';
import { ownsGuard } from '../src/lib/state/lock-guard';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const modes: [string, string[]][] = [
  ['source', [process.execPath, source]],
  ...(process.env.TALE_BINARY
    ? [['compiled', [resolve(process.env.TALE_BINARY)]] as [string, string[]]]
    : []),
];
const describePosix = describe.skipIf(process.platform === 'win32');

const input = {
  origin: 'https://native.example.org',
  email: 'operator@example.org',
  password: 'synthetic-command-password-private',
  slug: 'example-team',
  name: 'Example team',
  ssoEnabled: false,
  nativeClients: [
    {
      key: 'example-portal',
      name: 'Example portal',
      clientId: 'existing-client',
      redirectUris: ['https://portal.example.org/oauth/callback'],
    },
  ],
};
const cookie = 'session=synthetic-command-private';

async function run(
  executable: string[],
  args: string[],
  stdin: string | Uint8Array,
  cwd: string,
  prefix = ['deploy', 'provision'],
) {
  const child = Bun.spawn([...executable, ...prefix, ...args], {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      CI: 'true',
      TALE_ALIGNED: '',
      DATABASE_URL: '',
      BETTER_AUTH_SECRET: '',
    },
  });
  await child.stdin.write(stdin);
  await child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stdout + stderr).not.toContain(input.password);
  expect(stdout + stderr).not.toContain(cookie);
  expect(stdout + stderr).not.toContain('synthetic-stored-native-private');
  return { stdout, stderr, code };
}

function envelope(result: Awaited<ReturnType<typeof run>>, code: number) {
  const parsed = JSON.parse(result.stdout);
  expect(
    result.code,
    typeof parsed.error?.summary === 'string'
      ? parsed.error.summary
      : 'CLI response status',
  ).toBe(code);
  expect(result.stderr).toBe('');
  expect(result.stdout.trim().split('\n')).toHaveLength(1);
  return parsed;
}

async function bundle(directory: string) {
  await mkdir(join(directory, 'cli'));
  await mkdir(join(directory, 'runtime'));
  await writeFile(
    join(directory, 'cli/tale'),
    'synthetic reviewed executable',
    { mode: 0o755 },
  );
  await writeFile(join(directory, 'runtime/runtime.json'), '{}\n');
  await writeFile(join(directory, 'runtime/compose.yml'), 'services: {}\n');
  await writeDeploymentBundle(directory, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision: 'a'.repeat(40), path: 'cli/tale' },
    deploymentRef: 'c'.repeat(40),
    spec: deploymentSpecSchema.parse({
      schemaVersion: 1,
      name: 'example-native',
      stateDirectory: '/opt/example-native',
      composeProject: 'example-native',
      runtime: { revision: 'b'.repeat(40) },
      origin: input.origin,
      tlsMode: 'external',
      identity: {
        email: input.email,
        password: { env: 'EXAMPLE_OPERATOR_PASSWORD' },
        slug: input.slug,
        name: input.name,
        ssoEnabled: false,
        nativeClients: input.nativeClients,
      },
    }),
  });
}

for (const [label, executable] of modes)
  describePosix(`${label} native provisioning command`, () => {
    test.each([
      ['empty', ''],
      ['truncated JSON', '{"password":"synthetic-command-password-private'],
      ['oversized', ' '.repeat(65537)],
      ['invalid UTF-8', Buffer.from([0xc3, 0x28])],
    ] as const)(
      'rejects %s stdin outside a workspace before any native request',
      async (_name, raw) => {
        const directory = await mkdtemp(
          join(tmpdir(), 'tale-provision-stdin-'),
        );
        try {
          const result = envelope(
            await run(executable, ['--json', '--yes'], raw, directory),
            2,
          );
          expect(result.ok).toBe(false);
          expect(result.error.code).toBe(2);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    );

    test('requires confirmation outside a workspace before any native request', async () => {
      const directory = await mkdtemp(
        join(tmpdir(), 'tale-provision-confirm-'),
      );
      try {
        const unconfirmed = await run(
          executable,
          ['--json'],
          JSON.stringify(input),
          directory,
        );
        expect(unconfirmed.code).toBe(4);
        expect(unconfirmed.stdout + unconfirmed.stderr).toBe('');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    test('checks command bundle guards, unbundled exact-ID compatibility and isolated managed-helper sessions', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'tale-provision-native-'));
      const nativeData = await mkdtemp(join(tmpdir(), 'tale-provision-data-'));
      const nativeState = nativeDeploymentStateDirectory(
        nativeData,
        'example-native',
      );
      let requireNativeLock = false;
      const lockObservations: boolean[] = [];
      const calls: { path: string; method: string; origin: string | null }[] =
        [];
      let failDiscovery = false;
      // The production command deliberately has no input-selected API endpoint.
      // Own its fixed loopback port before spawning it; a busy port fails this
      // test before any request can reach a user's existing backend.
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 3005,
        async fetch(request) {
          const url = new URL(request.url);
          const path = url.pathname + url.search;
          calls.push({
            path,
            method: request.method,
            origin: request.headers.get('origin'),
          });
          if (requireNativeLock) {
            const held = await ownsGuard(nativeState);
            lockObservations.push(held);
            if (!held) return Response.json({}, { status: 503 });
          }
          if (request.headers.get('origin') !== input.origin)
            return Response.json({}, { status: 403 });
          if (path === '/api/auth/sign-in/email') {
            if (
              JSON.stringify(await request.json()) !==
              JSON.stringify({ email: input.email, password: input.password })
            )
              return Response.json({}, { status: 401 });
            return Response.json(
              {},
              { headers: { 'set-cookie': `${cookie}; HttpOnly; Path=/` } },
            );
          }
          if (request.headers.get('cookie') !== cookie)
            return Response.json({}, { status: 401 });
          if (path === '/api/auth/get-session')
            return Response.json({
              user: { id: 'native-operator', email: input.email },
              session: {
                userId: 'native-operator',
                activeOrganizationId: 'org-example',
              },
            });
          if (path === '/api/auth/organization/list')
            return Response.json([{ id: 'org-example', slug: input.slug }]);
          if (path === '/api/app/sso/config?orgId=org-example')
            return Response.json({
              configured: false,
              enabled: false,
              otherOrgsEnabled: false,
            });
          if (path === '/api/app/sso/discovery/configured')
            return failDiscovery
              ? Response.json({ error: input.password }, { status: 503 })
              : Response.json({ enabled: false, multiple: false });
          if (path === '/api/app/identity/clients?orgId=org-example')
            return Response.json({
              clients: [
                {
                  software_id: input.nativeClients[0].key,
                  client_id: input.nativeClients[0].clientId,
                  client_name: input.nativeClients[0].name,
                  redirect_uris: input.nativeClients[0].redirectUris,
                  disabled: false,
                  require_pkce: true,
                  skip_consent: false,
                  token_endpoint_auth_method: 'client_secret_post',
                  grant_types: ['authorization_code'],
                  response_types: ['code'],
                  scope: 'openid profile email tale:organization',
                  type: 'web',
                  taleOrganizationId: 'org-example',
                  client_secret: 'synthetic-stored-native-private',
                },
              ],
            });
          if (path === '/api/auth/sign-out')
            return Response.json({ success: true });
          return Response.json({}, { status: 404 });
        },
      });
      try {
        await bundle(directory);
        const args = ['--bundle', directory, '--json', '--yes'];
        const emptyBundle = envelope(
          await run(
            executable,
            ['--bundle', '', '--json', '--yes'],
            JSON.stringify(input),
            '/',
          ),
          2,
        );
        expect(emptyBundle.ok).toBe(false);
        expect(calls, JSON.stringify(calls)).toHaveLength(0);

        for (const flag of [
          '--dry-run',
          '--stop',
          '--override-all',
          '--skip-backup',
        ]) {
          const refused = envelope(
            await run(executable, [...args, flag], JSON.stringify(input), '/'),
            2,
          );
          expect(refused.ok).toBe(false);
          expect(calls, JSON.stringify(calls)).toHaveLength(0);
        }
        for (const flag of ['--cli-ref', '--deployment-ref']) {
          const withoutBundle = envelope(
            await run(
              executable,
              ['--json', '--yes', flag, 'a'.repeat(40)],
              JSON.stringify(input),
              '/',
            ),
            2,
          );
          expect(withoutBundle.ok).toBe(false);
          expect(calls, JSON.stringify(calls)).toHaveLength(0);
          const emptyWithoutBundle = envelope(
            await run(
              executable,
              ['--json', '--yes', flag, ''],
              JSON.stringify(input),
              '/',
            ),
            2,
          );
          expect(emptyWithoutBundle.ok).toBe(false);
          expect(calls, JSON.stringify(calls)).toHaveLength(0);

          const wrongPin = envelope(
            await run(
              executable,
              [...args, flag, 'd'.repeat(40)],
              JSON.stringify(input),
              '/',
            ),
            3,
          );
          expect(wrongPin.ok).toBe(false);
          expect(calls, JSON.stringify(calls)).toHaveLength(0);
          const emptyPin = envelope(
            await run(
              executable,
              [...args, flag, ''],
              JSON.stringify(input),
              '/',
            ),
            3,
          );
          expect(emptyPin.ok).toBe(false);
          expect(calls, JSON.stringify(calls)).toHaveLength(0);
        }
        const mismatch = envelope(
          await run(
            executable,
            args,
            JSON.stringify({ ...input, slug: 'wrong-team' }),
            '/',
          ),
          3,
        );
        expect(mismatch.ok).toBe(false);
        expect(calls, JSON.stringify(calls)).toHaveLength(0);
        for (const [prefix, flags] of [
          [['--yes', 'deploy', 'provision'], ['--json']],
          [['deploy', '--yes', 'provision'], ['--json']],
          [
            ['deploy', 'provision'],
            ['--json', '--yes'],
          ],
        ]) {
          const result = envelope(
            await run(executable, flags, JSON.stringify(input), '/', prefix),
            0,
          );
          expect(result).toEqual({
            ok: true,
            command: 'deploy provision',
            data: {
              organizationId: 'org-example',
              organizationSlug: input.slug,
              userId: 'native-operator',
              ssoEnabled: false,
              nativeClients: [
                {
                  key: input.nativeClients[0].key,
                  clientId: input.nativeClients[0].clientId,
                  changed: false,
                },
              ],
              configs: [],
            },
          });
          expect(JSON.stringify(result)).not.toContain('private');
        }
        expect(
          calls.filter(({ path }) => path === '/api/auth/sign-in/email'),
        ).toHaveLength(3);
        expect(
          calls.filter(({ path }) => path === '/api/auth/sign-out'),
        ).toHaveLength(3);
        expect(
          calls
            .filter(({ method }) => method !== 'GET')
            .map(({ path }) => path),
        ).toEqual([
          '/api/auth/sign-in/email',
          '/api/auth/sign-out',
          '/api/auth/sign-in/email',
          '/api/auth/sign-out',
          '/api/auth/sign-in/email',
          '/api/auth/sign-out',
        ]);
        // The bundled command runs inside its fixed /app/data backend volume.
        // This host-side loopback fixture never creates or redirects /app. Use
        // the established helper seam for its real HTTP + native-lock transaction;
        // production source/compiled commands above own public flag/refusals and
        // unbundled exact-ID compatibility, not a false native-image success.
        requireNativeLock = true;
        const retainedInput = parseInstanceInput(input);
        for (let replay = 0; replay < 2; replay++) {
          const managed = await provisionManagedBundle(
            directory,
            retainedInput,
            { cliRef: 'a'.repeat(40), deploymentRef: 'c'.repeat(40) },
            {
              dataDirectory: nativeData,
              configure: async (value, options) => {
                expect(options?.stateDirectory).toBe(nativeState);
                expect(await ownsGuard(nativeState)).toBe(true);
                return configureInstance(value, options);
              },
            },
          );
          expect(managed).toEqual({
            organizationId: 'org-example',
            organizationSlug: input.slug,
            userId: 'native-operator',
            ssoEnabled: false,
            nativeClients: [
              {
                key: input.nativeClients[0].key,
                clientId: input.nativeClients[0].clientId,
                changed: false,
              },
            ],
            configs: [],
          });
          expect(await ownsGuard(nativeState)).toBe(false);
          expect(JSON.stringify(managed)).not.toContain('private');
        }
        expect(lockObservations.length).toBeGreaterThan(0);
        expect(lockObservations.every(Boolean)).toBe(true);
        expect(
          calls.filter(({ path }) => path === '/api/auth/sign-in/email'),
        ).toHaveLength(5);
        expect(
          calls.filter(({ path }) => path === '/api/auth/sign-out'),
        ).toHaveLength(5);
        expect(
          calls
            .filter(({ method }) => method !== 'GET')
            .map(({ path }) => path),
        ).toEqual(
          Array.from({ length: 5 }, () => [
            '/api/auth/sign-in/email',
            '/api/auth/sign-out',
          ]).flat(),
        );
        requireNativeLock = false;
        failDiscovery = true;
        const failed = envelope(
          await run(
            executable,
            ['--json', '--yes'],
            JSON.stringify(input),
            '/',
          ),
          5,
        );
        expect(failed.ok).toBe(false);
        expect(failed.error.summary).toBe('SSO discovery failed (HTTP 503).');
        expect(calls.at(-1)?.path).toBe('/api/auth/sign-out');
        const beforeTamper = calls.length;
        await writeFile(
          join(directory, 'runtime/compose.yml'),
          'tampered bytes\n',
        );
        const tampered = envelope(
          await run(executable, args, JSON.stringify(input), '/'),
          3,
        );
        expect(tampered.ok).toBe(false);
        expect(calls).toHaveLength(beforeTamper);
      } finally {
        await server.stop(true);
        await rm(directory, { recursive: true, force: true });
        await rm(nativeData, { recursive: true, force: true });
      }
    }, 30_000);
  });
