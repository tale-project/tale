import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  copyDeploymentCli,
  verifyDeploymentBundle,
  writeDeploymentBundle,
} from './bundle';
import {
  deploymentSpecSchema,
  resolveDeploymentSpec,
  resolveValue,
} from './model';
import { withDeploymentSources } from './sources';

const testPosix = test.skipIf(process.platform === 'win32');

const roots: string[] = [];
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'tale-deployment-input-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const revision = 'b'.repeat(40);
const spec = () => ({
  schemaVersion: 1,
  name: 'north-labs',
  stateDirectory: join(tmpdir(), 'north-labs'),
  composeProject: 'tale',
  runtime: { revision, platform: 'linux/amd64' },
  origin: 'https://desk.north-labs.example',
  tlsMode: 'external',
  identity: {
    email: { env: 'LOCAL_EMAIL' },
    slug: 'north-labs',
    name: 'North Labs',
    ssoEnabled: false,
  },
  environment: { SENTRY_DSN: { env: 'SENTRY_DSN', optional: true } },
  configs: [
    {
      repository: 'https://github.com/north-labs/desk',
      revision,
      client: 'north-labs',
      descriptor: 'tale/client.json',
      automation: 'review-desk',
      projectId: 'native-project',
    },
  ],
});

test('resolves full source pins while retaining host credential references', () => {
  const input = spec();
  const resolved = resolveDeploymentSpec(
    {
      ...input,
      runtime: { ...input.runtime, revision: { env: 'RUNTIME_REF' } },
      configs: input.configs.map((config) =>
        Object.assign({}, config, {
          revision: { env: 'CLIENT_REF' },
        }),
      ),
    },
    {
      RUNTIME_REF: revision,
      CLIENT_REF: revision,
      LOCAL_EMAIL: 'private@example.com',
      SENTRY_DSN: 'private-marker',
    },
  );
  expect(resolved.runtime.revision).toBe(revision);
  expect(resolved.configs[0]?.revision).toBe(revision);
  expect(JSON.stringify(resolved)).not.toContain('private-marker');
  expect(JSON.stringify(resolved)).not.toContain('private@example.com');
  expect(resolved.identity?.email).toEqual({ env: 'LOCAL_EMAIL' });
  expect(resolveValue({ env: 'OPTIONAL', optional: true }, {})).toBe('');
  expect(() => resolveValue({ env: 'MISSING' }, {})).toThrow('MISSING');
  expect(() =>
    resolveValue({ env: 'PASSWORD' }, { PASSWORD: 'private-marker\nnext' }),
  ).toThrow('control characters');
});

test('refuses moving pins, path escapes, duplicate targets and invalid public policy', () => {
  for (const bad of ['main', 'sha-abcd123', `${revision}\n`, 'v1.2.3'])
    expect(() =>
      resolveDeploymentSpec({ ...spec(), runtime: { revision: bad } }),
    ).toThrow();
  for (const bad of ['/', 'relative', '/opt/a/../b', '/opt/state\n'])
    expect(() =>
      deploymentSpecSchema.parse({ ...spec(), stateDirectory: bad }),
    ).toThrow();
  for (const bad of [
    'https://github.com/owner/../repo',
    'https://github.com/owner/repo.git',
    'https://user@github.com/owner/repo',
    'https://github.com/owner/repo?token=private',
  ])
    expect(() =>
      deploymentSpecSchema.parse({
        ...spec(),
        configs: [{ ...spec().configs[0], repository: bad }],
      }),
    ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({
      ...spec(),
      configs: [...spec().configs, ...spec().configs],
    }),
  ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({ ...spec(), identity: undefined }),
  ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({ ...spec(), tlsMode: 'letsencrypt' }),
  ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({
      ...spec(),
      origin: 'https://example.com/path',
    }),
  ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({
      ...spec(),
      configs: [
        { ...spec().configs[0], receiptPath: 'north-labs/providers/main.json' },
      ],
    }),
  ).toThrow();
  expect(() =>
    deploymentSpecSchema.parse({
      ...spec(),
      identity: { ...spec().identity, ssoEnabled: true },
    }),
  ).toThrow();
});

test('resolves fleet-owned public URLs once and refuses invalid or unresolved bundle URLs', () => {
  const input = {
    ...spec(),
    origin: { env: 'PUBLIC_ORIGIN' },
    identity: {
      ...spec().identity,
      nativeClients: [
        {
          key: 'portal',
          name: 'Portal',
          clientId: 'existing-client',
          redirectUris: [{ env: 'PUBLIC_CALLBACK' }],
        },
      ],
    },
  };
  const resolved = resolveDeploymentSpec(input, {
    PUBLIC_ORIGIN: 'https://native.example.org',
    PUBLIC_CALLBACK: 'https://portal.example.org/oauth/callback',
  });
  expect(resolved.origin).toBe('https://native.example.org');
  expect(resolved.identity?.nativeClients[0]?.redirectUris).toEqual([
    'https://portal.example.org/oauth/callback',
  ]);
  expect(() => deploymentSpecSchema.parse(input)).toThrow();
  for (const origin of [
    'http://native.example.org',
    'https://native.example.org/path',
    'https://native.example.org\n',
  ])
    expect(() =>
      resolveDeploymentSpec(input, {
        PUBLIC_ORIGIN: origin,
        PUBLIC_CALLBACK: 'https://portal.example.org/oauth/callback',
      }),
    ).toThrow();
  expect(() =>
    resolveDeploymentSpec(input, {
      PUBLIC_ORIGIN: 'https://native.example.org',
    }),
  ).toThrow('PUBLIC_CALLBACK');
});

function binary(machine = 62): Buffer<ArrayBuffer> {
  const bytes = Buffer.alloc(128);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}
async function bundleFixture() {
  const root = temporary();
  const executable = join(temporary(), 'tale');
  writeFileSync(executable, binary());
  await copyDeploymentCli(executable, root, 'linux/amd64');
  await mkdir(join(root, 'runtime'));
  await writeFile(join(root, 'runtime', 'runtime.json'), '{}\n');
  await writeFile(join(root, 'runtime', 'compose.yml'), 'services: {}\n');
  await writeDeploymentBundle(root, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision, path: 'cli/tale' },
    deploymentRef: revision,
    spec: resolveDeploymentSpec(spec()),
  });
  return root;
}

// Windows has no POSIX executable-mode custody; its CLI refuses this operation.
testPosix(
  'whole bundle proof rejects changed bytes, companions, symlinks and wrong source pins',
  async () => {
    const root = await bundleFixture();
    const verified = await verifyDeploymentBundle(root, {
      cliRef: revision,
      deploymentRef: revision,
    });
    expect(verified.files.map((file) => file.path)).toEqual([
      'cli/tale',
      'runtime/compose.yml',
      'runtime/runtime.json',
    ]);
    await expect(
      verifyDeploymentBundle(root, { cliRef: 'a'.repeat(40) }),
    ).rejects.toThrow('source pins');
    for (const invalid of ['', 'main', `${revision}\n`]) {
      await expect(
        verifyDeploymentBundle(root, { cliRef: invalid }),
      ).rejects.toThrow('full commit SHAs');
      await expect(
        verifyDeploymentBundle(root, { deploymentRef: invalid }),
      ).rejects.toThrow('full commit SHAs');
    }
    await writeFile(join(root, 'unexpected.txt'), 'extra');
    await expect(verifyDeploymentBundle(root)).rejects.toThrow('inventory');
    rmSync(join(root, 'unexpected.txt'));
    await symlink(join(root, 'cli/tale'), join(root, 'other'));
    await expect(verifyDeploymentBundle(root)).rejects.toThrow('symlink');
    rmSync(join(root, 'other'));
    await writeFile(
      join(root, 'runtime', 'compose.yml'),
      'services: {changed: true}\n',
    );
    await expect(verifyDeploymentBundle(root)).rejects.toThrow('bytes');
  },
);

test('plain runtimes and the wrong executable architecture are never shipped', async () => {
  const executable = join(temporary(), 'tale');
  writeFileSync(executable, '#!/bin/sh\necho fake\n');
  await expect(
    copyDeploymentCli(executable, temporary(), 'linux/amd64'),
  ).rejects.toThrow('Linux Tale executable');
  writeFileSync(executable, binary(183));
  await expect(
    copyDeploymentCli(executable, temporary(), 'linux/amd64'),
  ).rejects.toThrow('architecture');
  const root = temporary();
  await copyDeploymentCli(executable, root, 'linux/arm64');
  expect(readFileSync(join(root, 'cli/tale'))).toEqual(binary(183));
});

test('local source selection reads real Git without a network call or worktree edits', async () => {
  const root = temporary();
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'source.txt'), 'committed');
  git('add', 'source.txt');
  git('commit', '--quiet', '-m', 'source');
  const commit = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'source.txt'), 'local edit');
  const sourcesFile = join(temporary(), 'sources.json');
  writeFileSync(
    sourcesFile,
    JSON.stringify({ [`https://github.com/north-labs/desk@${commit}`]: root }),
  );
  const calls: string[][] = [];
  await withDeploymentSources(
    [{ repository: 'https://github.com/north-labs/desk', revision: commit }],
    {
      sourcesFile,
      fetchImpl: () => {
        throw new Error('network forbidden');
      },
      run: async (command, args, options) => {
        calls.push(args);
        expect(command).toBe('git');
        expect(args).not.toContain('fetch');
        const child = Bun.spawn([command, ...args], {
          env: options?.env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { stdout, stderr, exitCode, success: exitCode === 0 };
      },
    },
    async (source) => {
      expect(
        source({
          repository: 'https://github.com/north-labs/desk',
          revision: commit,
        }),
      ).toBe(root);
    },
  );
  expect(calls).toHaveLength(1);
  expect(readFileSync(join(root, 'source.txt'), 'utf8')).toBe('local edit');
});

test('failed private source checkout scrubs errors and removes its ephemeral key', async () => {
  let keyFile = '';
  let keySeen = false;
  await expect(
    withDeploymentSources(
      [{ repository: 'https://github.com/north-labs/desk', revision }],
      {
        sourceKey: 'private-source-key-marker',
        fetchImpl: async () =>
          Response.json({
            ssh_keys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake'],
          }),
        run: async (_command, args, options) => {
          if (args.includes('fetch')) {
            const ssh = options?.env?.GIT_SSH_COMMAND ?? '';
            const match = /'-i' '([^']+)'/.exec(ssh);
            keyFile = match?.[1] ?? '';
            expect(ssh).toContain('StrictHostKeyChecking=yes');
            expect(ssh).toContain('IdentitiesOnly=yes');
            expect(options?.env).not.toHaveProperty('TALE_SOURCE_SSH_KEY');
            keySeen =
              readFileSync(keyFile, 'utf8') === 'private-source-key-marker';
            return {
              stdout: '',
              stderr: 'private-source-key-marker',
              exitCode: 1,
              success: false,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        },
      },
      async () => {
        throw new Error('must not reach source consumer');
      },
    ),
  ).rejects.toThrow('read-only checkout key');
  expect(keySeen).toBe(true);
  expect(() => readFileSync(keyFile)).toThrow();
});
