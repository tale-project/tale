import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { valueHash } from '../src/lib/config/releases/identity';
import { record } from '../src/lib/config/releases/model';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const binary = process.env.TALE_BINARY
  ? resolve(process.env.TALE_BINARY)
  : undefined;
const modes: [string, string[]][] = [
  ['source', [process.execPath, source]],
  ...(binary ? [['compiled', [binary]] as [string, string[]]] : []),
];
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'tale-settings-command-'));
  directories.push(directory);
  return directory;
}

async function run(
  executable: string[],
  args: string[],
  cwd: string,
  cookie = '',
) {
  const child = Bun.spawn([...executable, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, TALE_CONFIG_COOKIE: cookie, TALE_ALIGNED: '' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

function envelope(result: Awaited<ReturnType<typeof run>>, code = 0) {
  expect(result.code, result.stdout + result.stderr).toBe(code);
  expect(result.stderr).toBe('');
  const lines = result.stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  const parsed = JSON.parse(lines[0]);
  expect(parsed.ok).toBe(code === 0);
  if (code !== 0) expect(parsed.error.code).toBe(code);
  return parsed;
}

/** A loopback HTTP contract fixture, not a running Tale backend. The child
 * process must perform real JSON, session headers, scoped reads and native CAS. */
function fixture() {
  const directory = temporary();
  const file = join(directory, 'configuration.json');
  const plan = join(directory, 'plan.json');
  const receipt = join(directory, 'receipt.json');
  const workspace = join(directory, 'tale.json');
  writeFileSync(workspace, JSON.stringify({ cliVersion: '0.0.1' }));
  const declaration = {
    schemaVersion: 1,
    resources: [
      {
        kind: 'branding',
        config: { accentColor: '#245688', logoFilename: 'grün.svg' },
      },
      {
        kind: 'governance',
        key: 'session_idle_timeout',
        config: { enabled: true, idleTimeoutMinutes: 10 },
      },
    ],
  };
  writeFileSync(file, JSON.stringify(declaration));
  const cookie = `session=${randomUUID()}`;
  const origin = 'https://settings.example.invalid';
  const organization = { id: 'organization-example', slug: 'example-office' };
  const entries = new Map<string, { config: unknown; hash: string }>();
  let serial = 0;
  function mutate(id: string, config: unknown) {
    entries.set(id, {
      config: structuredClone(config),
      hash: valueHash({ config, serial: ++serial }),
    });
  }
  mutate('branding', { accentColor: '#112233' });
  const requests: {
    method: string;
    path: string;
    query: string;
    cookie: string | null;
    origin: string | null;
    type: string | null;
    body: unknown;
  }[] = [];
  const writes: string[] = [];
  const controls = {
    response: '',
    sessionMismatch: false,
    failWrite: '',
    beforeWrite: (_id: string) => {},
  };
  const privateBody = `private-native-response-${randomUUID()}`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === 'GET' ? undefined : await request.json();
      requests.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        cookie: request.headers.get('cookie'),
        origin: request.headers.get('origin'),
        type: request.headers.get('content-type'),
        body,
      });
      if (
        request.headers.get('cookie') !== cookie ||
        request.headers.get('origin') !== origin
      )
        return new Response(privateBody, { status: 401 });
      if (url.pathname === '/api/auth/get-session')
        return Response.json({
          user: { id: 'operator-example' },
          session: {
            userId: controls.sessionMismatch
              ? 'another-user'
              : 'operator-example',
          },
        });
      if (url.pathname === '/api/auth/organization/list')
        return Response.json([organization]);
      if (
        url.searchParams.getAll('orgId').length !== 1 ||
        url.searchParams.get('orgId') !== organization.id
      )
        return new Response(privateBody, { status: 403 });
      if (controls.response === 'http')
        return new Response(privateBody, { status: 503 });
      if (controls.response === 'json')
        return new Response(`{"private":"${privateBody}`);
      if (controls.response === 'oversized')
        return Response.json({
          private: privateBody,
          padding: 'x'.repeat(1_048_576),
        });
      let id: string;
      if (
        ['/api/app/branding/config', '/api/app/branding/save'].includes(
          url.pathname,
        )
      )
        id = 'branding';
      else if (
        url.pathname === '/api/app/governance/policies/session_idle_timeout'
      )
        id = 'governance/session_idle_timeout';
      else return new Response(privateBody, { status: 404 });
      if (request.method === 'GET') {
        const current = entries.get(id);
        if (id.startsWith('governance/')) {
          if (url.searchParams.get('includeHash') !== '1')
            return new Response(privateBody, { status: 400 });
          return Response.json({
            policy: current
              ? { key: 'session_idle_timeout', config: current.config }
              : null,
            hash: current?.hash ?? null,
          });
        }
        return Response.json({
          config: current?.config ?? null,
          hash: current?.hash ?? null,
        });
      }
      if (
        request.method !== 'POST' ||
        request.headers.get('content-type') !== 'application/json'
      )
        return new Response(privateBody, { status: 400 });
      controls.beforeWrite(id);
      if (!record(body)) return new Response(privateBody, { status: 400 });
      const payload = body;
      if (payload.expectedHash !== (entries.get(id)?.hash ?? null))
        return Response.json(
          { error: 'CONFIG_VERSION_CONFLICT', private: privateBody },
          { status: 409 },
        );
      if (controls.failWrite === id)
        return new Response(privateBody, { status: 503 });
      const { expectedHash: _expected, ...fields } = payload;
      mutate(id, id === 'branding' ? fields : payload.config);
      writes.push(id);
      return Response.json(
        id === 'branding' ? { hash: entries.get(id)!.hash } : { ok: true },
      );
    },
  });
  const target = [
    '--file',
    file,
    '--url',
    `http://127.0.0.1:${server.port}`,
    '--origin',
    origin,
    '--org',
    organization.id,
    '--json',
  ];
  return {
    directory,
    file,
    plan,
    receipt,
    workspace,
    declaration,
    cookie,
    origin,
    organization,
    entries,
    mutate,
    requests,
    writes,
    controls,
    privateBody,
    server,
    target,
  };
}

for (const [label, executable] of modes)
  describe(`${label} standalone platform configuration HTTP commands`, () => {
    test('validate/read/plan/apply/replay use native CAS, private journals and read-only membership', async () => {
      const f = fixture();
      try {
        const before = readFileSync(f.file);
        const workspace = readFileSync(f.workspace);
        const valid = envelope(
          await run(
            executable,
            ['config', 'validate', '--file', f.file, '--json'],
            f.directory,
          ),
        );
        expect(valid.command).toBe('config validate');
        expect(valid.data.resources).toEqual([
          'branding',
          'governance/session_idle_timeout',
        ]);
        expect(f.requests).toHaveLength(0);
        const read = envelope(
          await run(
            executable,
            ['config', 'read', ...f.target],
            f.directory,
            f.cookie,
          ),
        );
        expect(read.command).toBe('config read');
        expect(
          read.data.resources.map(
            (resource: { matches: boolean }) => resource.matches,
          ),
        ).toEqual([false, false]);
        const planned = envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        expect(planned.command).toBe('config plan');
        expect(
          planned.data.resources.map(
            (resource: { action: string }) => resource.action,
          ),
        ).toEqual(['update', 'create']);
        expect(planned.data.target).toEqual({
          origin: f.origin,
          organizationId: f.organization.id,
          organizationSlug: f.organization.slug,
        });
        expect(JSON.parse(readFileSync(f.plan, 'utf8'))).toEqual(planned.data);
        expect(f.requests.every((request) => request.method === 'GET')).toBe(
          true,
        );
        const applied = envelope(
          await run(
            executable,
            [
              'config',
              'apply',
              ...f.target,
              '--plan',
              f.plan,
              '--receipt',
              f.receipt,
              '--yes',
            ],
            f.directory,
            f.cookie,
          ),
        );
        expect(applied.command).toBe('config apply');
        expect(applied.data.configured).toBe(true);
        expect(applied.data.unchanged).toBe(false);
        expect(applied.data.restartRequired).toBe(false);
        expect(f.writes).toEqual([
          'branding',
          'governance/session_idle_timeout',
        ]);
        expect(
          f.requests
            .filter((request) => request.method === 'POST')
            .map((request) => request.body),
        ).toEqual([
          {
            ...f.declaration.resources[0].config,
            expectedHash: planned.data.resources[0].revision,
          },
          { config: f.declaration.resources[1].config, expectedHash: null },
        ]);
        const readyBytes = readFileSync(f.receipt);
        const ready = JSON.parse(readyBytes.toString());
        expect(ready.phase).toBe('ready');
        expect(ready.verified).toHaveLength(2);
        if (process.platform !== 'win32') {
          expect(statSync(f.plan).mode & 0o777).toBe(0o600);
          expect(statSync(f.receipt).mode & 0o777).toBe(0o600);
        }
        const count = f.requests.length;
        const replay = envelope(
          await run(
            executable,
            [
              '--yes',
              'config',
              'apply',
              ...f.target,
              '--plan',
              f.plan,
              '--receipt',
              f.receipt,
            ],
            f.directory,
            f.cookie,
          ),
        );
        expect(replay.data.unchanged).toBe(true);
        expect(
          f.requests.slice(count).every((request) => request.method === 'GET'),
        ).toBe(true);
        expect(readFileSync(f.receipt)).toEqual(readyBytes);
        expect(
          f.requests.every(
            (request) =>
              request.cookie === f.cookie &&
              request.origin === f.origin &&
              new URLSearchParams(request.query).getAll('orgId').join() ===
                f.organization.id,
          ),
        ).toBe(true);
        expect(
          f.requests
            .filter((request) => request.path.startsWith('/api/auth/'))
            .every((request) => request.method === 'GET'),
        ).toBe(true);
        expect(
          f.requests.some((request) => request.path.includes('set-active')),
        ).toBe(false);
        expect(
          [valid, planned, applied, replay, ready]
            .map((value) => JSON.stringify(value))
            .join(),
        ).not.toContain(f.cookie);
        expect(readFileSync(f.file)).toEqual(before);
        expect(readFileSync(f.workspace)).toEqual(workspace);
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('stale reviewed preimages and unproved organizations cannot write settings', async () => {
      const f = fixture();
      try {
        envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        f.mutate('branding', { accentColor: '#abcdef' });
        const stale = envelope(
          await run(
            executable,
            [
              'config',
              'apply',
              ...f.target,
              '--plan',
              f.plan,
              '--receipt',
              f.receipt,
              '--yes',
            ],
            f.directory,
            f.cookie,
          ),
          3,
        );
        expect(stale.error.summary).toContain('changed since planning');
        expect(f.writes).toHaveLength(0);
        expect(existsSync(f.receipt)).toBe(false);
        const mismatched = JSON.parse(readFileSync(f.plan, 'utf8'));
        mismatched.target.organizationId = 'another-organization';
        writeFileSync(f.plan, JSON.stringify(mismatched));
        const targetRefusal = envelope(
          await run(
            executable,
            [
              'config',
              'apply',
              ...f.target,
              '--plan',
              f.plan,
              '--receipt',
              f.receipt,
              '--yes',
            ],
            f.directory,
            f.cookie,
          ),
          3,
        );
        expect(targetRefusal.error.summary).toContain('plan differs');
        expect(f.writes).toHaveLength(0);
        for (const mismatch of ['organization', 'session']) {
          const start = f.requests.length;
          f.controls.sessionMismatch = mismatch === 'session';
          const target =
            mismatch === 'organization'
              ? f.target.map((part) =>
                  part === f.organization.id ? 'another-organization' : part,
                )
              : f.target;
          const refused = envelope(
            await run(
              executable,
              ['config', 'read', ...target],
              f.directory,
              f.cookie,
            ),
            3,
          );
          expect(refused.error.summary).toContain('does not prove');
          expect(
            f.requests.slice(start).map((request) => request.path),
          ).toEqual(['/api/auth/get-session', '/api/auth/organization/list']);
        }
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('cookie and noninteractive consent refusal preserve the plan and do not mutate', async () => {
      const f = fixture();
      try {
        envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        const args = [
          'config',
          'apply',
          ...f.target,
          '--plan',
          f.plan,
          '--receipt',
          f.receipt,
        ];
        const before = f.requests.length;
        const missing = envelope(
          await run(executable, [...args, '--yes'], f.directory),
          3,
        );
        expect(missing.error.summary).toContain('session cookie');
        expect(f.requests).toHaveLength(before);
        const refused = await run(executable, args, f.directory, f.cookie);
        // The shared CLI interrupt renderer intentionally exits 4 quietly in JSON mode.
        expect(refused).toEqual({ code: 4, stdout: '', stderr: '' });
        expect(
          f.requests.slice(before).every((request) => request.method === 'GET'),
        ).toBe(true);
        expect(f.writes).toHaveLength(0);
        expect(existsSync(f.receipt)).toBe(false);
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('output collisions including a directory alias preserve declaration and plan bytes before HTTP', async () => {
      const f = fixture();
      try {
        const input = readFileSync(f.file);
        const alias = join(temporary(), 'alias');
        symlinkSync(
          f.directory,
          alias,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
        for (const output of [f.file, join(alias, 'configuration.json')]) {
          envelope(
            await run(
              executable,
              ['config', 'plan', ...f.target, '--output', output],
              f.directory,
              f.cookie,
            ),
            2,
          );
          expect(readFileSync(f.file)).toEqual(input);
          expect(f.requests).toHaveLength(0);
        }
        envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        const saved = readFileSync(f.plan);
        const count = f.requests.length;
        for (const receipt of [f.file, f.plan]) {
          envelope(
            await run(
              executable,
              [
                'config',
                'apply',
                ...f.target,
                '--plan',
                f.plan,
                '--receipt',
                receipt,
                '--yes',
              ],
              f.directory,
              f.cookie,
            ),
            2,
          );
          expect(readFileSync(f.file)).toEqual(input);
          expect(readFileSync(f.plan)).toEqual(saved);
          expect(f.requests).toHaveLength(count);
        }
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('HTTP failures and invalid or oversized JSON return one safe diagnostic', async () => {
      const f = fixture();
      try {
        for (const response of ['http', 'json', 'oversized']) {
          f.controls.response = response;
          const result = await run(
            executable,
            ['config', 'read', ...f.target, '--verbose'],
            f.directory,
            f.cookie,
          );
          const error = envelope(result, 5);
          expect(error.error.summary).toContain(
            response === 'http' ? 'HTTP 503' : 'invalid or oversized JSON',
          );
          expect(result.stdout + result.stderr).not.toContain(f.privateBody);
          expect(result.stdout + result.stderr).not.toContain(f.cookie);
        }
        expect(f.writes).toHaveLength(0);
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('a native CAS race retains a pending receipt and never overwrites the raced value', async () => {
      const f = fixture();
      try {
        envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        f.controls.beforeWrite = (id) => {
          if (id === 'branding') f.mutate(id, { accentColor: '#aabbcc' });
        };
        const result = await run(
          executable,
          [
            'config',
            'apply',
            ...f.target,
            '--plan',
            f.plan,
            '--receipt',
            f.receipt,
            '--yes',
          ],
          f.directory,
          f.cookie,
        );
        envelope(result, 3);
        expect(f.entries.get('branding')?.config).toEqual({
          accentColor: '#aabbcc',
        });
        expect(f.writes).toHaveLength(0);
        expect(JSON.parse(readFileSync(f.receipt, 'utf8'))).toMatchObject({
          phase: 'pending',
          verified: [],
        });
        expect(result.stdout + result.stderr).not.toContain(f.privateBody);
        expect(result.stdout + result.stderr).not.toContain(f.cookie);
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);

    test('partial apply resumes the same reviewed plan after verified readback without repeating its first write', async () => {
      const f = fixture();
      try {
        envelope(
          await run(
            executable,
            ['config', 'plan', ...f.target, '--output', f.plan],
            f.directory,
            f.cookie,
          ),
        );
        f.controls.failWrite = 'governance/session_idle_timeout';
        const args = [
          'config',
          'apply',
          ...f.target,
          '--plan',
          f.plan,
          '--receipt',
          f.receipt,
          '--yes',
        ];
        const result = await run(executable, args, f.directory, f.cookie);
        const failed = envelope(result, 3);
        expect(failed.error.summary).toContain('after 1 verified resource');
        const pending = JSON.parse(readFileSync(f.receipt, 'utf8'));
        expect(pending.phase).toBe('pending');
        expect(
          pending.verified.map((entry: { id: string }) => entry.id),
        ).toEqual(['branding']);
        expect(f.writes).toEqual(['branding']);
        expect(result.stdout + result.stderr).not.toContain(f.privateBody);
        f.controls.failWrite = '';
        const applied = envelope(
          await run(executable, args, f.directory, f.cookie),
        );
        expect(applied.data.configured).toBe(true);
        expect(f.writes).toEqual([
          'branding',
          'governance/session_idle_timeout',
        ]);
        expect(JSON.parse(readFileSync(f.receipt, 'utf8')).phase).toBe('ready');
      } finally {
        await f.server.stop(true);
      }
    }, 30_000);
  });
