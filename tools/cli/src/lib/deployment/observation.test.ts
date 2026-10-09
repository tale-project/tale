import { afterEach, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import type { exec } from '../docker/exec';
import { observeDeployment } from './observation';
import { ObservationPhaseError } from './observation-errors';
const testPosix = test.skipIf(process.platform === 'win32');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'tale-observation-test-')),
  );
  roots.push(root);
  const binary = join(root, 'tale');
  writeFileSync(binary, 'synthetic-cli', { mode: 0o700 });
  const state = join(root, 'state');
  mkdirSync(join(state, '.tale'), { recursive: true, mode: 0o700 });
  const ready = join(state, '.tale/deployment-ready.json');
  const proof = {
    schemaVersion: 1,
    phase: 'ready',
    name: 'north',
    revision: 'b'.repeat(40),
    cliRevision: 'c'.repeat(40),
    bundleSha256: 'd'.repeat(64),
    native: {
      organizationId: 'org-north',
      organizationSlug: 'north',
      userId: 'operator',
    },
  };
  writeFileSync(ready, JSON.stringify(proof), { mode: 0o600 });
  const spec = {
    schemaVersion: 1,
    name: 'north',
    stateDirectory: state,
    composeProject: 'north',
    runtime: { revision: 'b'.repeat(40) },
    origin: 'https://north.invalid',
    tlsMode: 'external',
    identity: {
      email: { env: 'OPERATOR_EMAIL' },
      password: { env: 'OPERATOR_PASSWORD' },
      slug: 'north',
      name: 'North',
      ssoEnabled: false,
    },
  };
  const specFile = join(root, 'spec.json');
  writeFileSync(specFile, JSON.stringify(spec), { mode: 0o600 });
  const options = {
    spec: specFile,
    cliRef: 'a'.repeat(40),
    deploymentRef: 'e'.repeat(40),
    machineIdSha256: sha256('f'.repeat(32)),
  };
  const input = {
    environment: {
      OPERATOR_EMAIL: 'operator@example.invalid',
      OPERATOR_PASSWORD: 'synthetic-password',
      UNRELATED: 'not-forwarded',
    },
  };
  const containers = ['db', 'knowledge-db', 'backend-api'].map(
    (service, i) => ({
      id: String(i + 1).repeat(64),
      image: `sha256:${'6'.repeat(64)}`,
      project: 'north',
      service,
      running: true,
      startedAt: '2026-01-01T00:00:00.000000000Z',
      restartCount: 0,
      mounts: [{ Type: 'bind', Source: state, Destination: '/data' }],
    }),
  );
  const corpus = (schema: string) => ({
    schema,
    chunks: 2,
    legacyVectors: 2,
    legacyVectorBytes: 64,
    chunkRelationBytes: 8192,
    vectorRelations: [],
  });
  const sql = [
    JSON.stringify({ schema: 'public', ids: ['0001_initial.sql'] }) +
      '\n' +
      JSON.stringify({ safeTable: true, unfinished: true, owned: false }),
    [
      '["1"]',
      '["2"]',
      JSON.stringify(corpus('private_knowledge')),
      JSON.stringify(corpus('public_web')),
    ].join('\n'),
  ];
  const calls: { args: string[]; stdin?: string }[] = [];
  const native = {
    status: 'observed',
    identity: {
      name: 'north',
      origin: spec.origin,
      organizationId: 'org-north',
      organizationSlug: 'north',
      organizationName: 'North',
      userId: 'operator',
    },
    configurations: [],
    claim:
      'Retained artifact, current native version and owned asset bytes verified; no deployment or cutover authorization.',
  };
  let onCall: (args: string[]) => void = () => {};
  let nativeData: unknown = native;
  const run: typeof exec = async (command, args, execution) => {
    expect(command).toBe('docker');
    expect(execution?.env).toEqual({
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      LANG: 'C',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
    });
    expect(execution?.silent).toBe(true);
    expect(execution?.timeout).toBeLessThanOrEqual(46);
    calls.push({ args, stdin: execution?.stdin });
    onCall(args);
    let stdout = '';
    let exitCode = 0;
    if (args[0] === 'ps')
      stdout = containers.map((container) => container.id).join('\n');
    else if (args[0] === 'inspect')
      stdout = containers
        .map((container) => JSON.stringify(container))
        .join('\n');
    else if (args[0] === 'image')
      stdout = JSON.stringify({
        id: containers[0].image,
        revision: proof.revision,
        version: '0.5.76',
        architecture: 'amd64',
        os: 'linux',
      });
    else if (args.includes('sh')) {
      expect(execution?.stdin).toContain('BEGIN READ ONLY;');
      expect(execution?.stdin).not.toMatch(
        /LOCK TABLE|INSERT |UPDATE |DELETE |CREATE |ALTER /,
      );
      stdout = sql[args[2] === containers[0].id ? 0 : 1];
    } else if (args.includes('stat'))
      stdout = args.includes('%F:%u:%g:%a:%h')
        ? 'directory:0:1000:510:2\nregular file:0:1000:550:1'
        : args.includes('%F:%u')
          ? 'directory:0'
          : '1000:1000';
    else if (args.includes('sha256sum'))
      stdout = `${sha256('synthetic-cli')}  ${args.at(-1)}`;
    else if (args.includes('observe-native')) {
      const parsed = JSON.parse(execution?.stdin ?? '{}');
      expect(parsed.operator).toEqual({
        email: input.environment.OPERATOR_EMAIL,
        password: input.environment.OPERATOR_PASSWORD,
      });
      expect(execution?.stdin).not.toContain('not-forwarded');
      const ok = (nativeData as { status: string }).status === 'observed';
      exitCode = ok ? 0 : 3;
      stdout = JSON.stringify({
        command: 'deploy observe-native',
        ok,
        data: nativeData,
      });
    } else if (args[0] === 'cp') expect(args[1]).toBe(binary);
    else if (
      args[0] === 'exec' &&
      ['mkdir', 'chown', 'chmod', 'rm'].includes(args[2])
    )
      expect(args.at(-1)).toMatch(
        /^\/tmp\/tale-observe-[a-f0-9-]+(?:\/tale)?$/,
      );
    else throw Error('unexpected IO');
    return { stdout, stderr: '', exitCode, success: exitCode === 0 };
  };
  return {
    root,
    state,
    ready,
    binary,
    options,
    input,
    proof,
    containers,
    calls,
    run,
    native,
    setNative: (value: unknown) => {
      nativeData = value;
    },
    hook: (value: typeof onCall) => {
      onCall = value;
    },
    dependencies: {
      exec: run,
      environment: {},
      machineId: () => Buffer.from('f'.repeat(32)),
      build: () => ({ revision: options.cliRef, binary }),
    },
  };
}

testPosix(
  'observes runtime and retained facts with only scoped temporary tooling writes',
  async () => {
    const f = fixture();
    const before = readFileSync(f.ready);
    const result = await observeDeployment(f.options, f.input, f.dependencies);
    expect(result.complete).toBe(true);
    const nativeCall = f.calls.find(({ args }) =>
      args.includes('observe-native'),
    );
    expect(nativeCall?.args).toEqual(
      expect.arrayContaining([
        'HTTP_PROXY=',
        'HTTPS_PROXY=',
        'ALL_PROXY=',
        'http_proxy=',
        'https_proxy=',
        'all_proxy=',
        'NO_PROXY=*',
        'no_proxy=*',
      ]),
    );
    expect(result.database.legacyAutomationCensus).toEqual({
      unfinished: true,
      observerOwnsCutoverLock: false,
    });
    expect(result.claim).toContain('not Ready');
    expect(readFileSync(f.ready)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('synthetic-password');
    expect(JSON.stringify(result)).not.toContain('not-forwarded');
    const mutations = f.calls.filter(
      ({ args }) =>
        args[0] === 'cp' || ['mkdir', 'chown', 'chmod', 'rm'].includes(args[2]),
    );
    expect(mutations).toHaveLength(6);
    expect(
      f.calls.some(
        ({ args }) => args.includes('pull') || args.includes('compose'),
      ),
    ).toBe(false);
  },
);

testPosix(
  'missing native custody retains partial report without treating it as acceptance',
  async () => {
    const f = fixture();
    f.setNative({ status: 'unavailable', reason: 'retained_stage_missing' });
    const result = await observeDeployment(f.options, f.input, f.dependencies);
    expect(result.complete).toBe(false);
    expect(result.native).toEqual({
      status: 'unavailable',
      reason: 'retained_stage_missing',
    });
    expect(f.calls.at(-3)?.args.includes('rm')).toBe(true);
  },
);

testPosix(
  'missing Ready remains absent and never copies or invokes a native CLI',
  async () => {
    const f = fixture();
    rmSync(f.ready);
    const result = await observeDeployment(f.options, f.input, f.dependencies);
    expect(result.complete).toBe(false);
    expect(result.retained.status).toBe('unavailable');
    expect(
      f.calls.some(
        ({ args }) => args[0] === 'cp' || args.includes('observe-native'),
      ),
    ).toBe(false);
  },
);

testPosix.each([
  'remote',
  'context',
  'tls',
  'source',
  'machine',
  'pending',
  'private-map',
])('refuses %s before Docker or temporary writes', async (fault) => {
  const f = fixture();
  if (fault === 'remote')
    Object.assign(f.dependencies.environment, {
      DOCKER_HOST: 'ssh://other-host',
    });
  if (fault === 'context')
    Object.assign(f.dependencies.environment, { DOCKER_CONTEXT: 'default' });
  if (fault === 'tls')
    Object.assign(f.dependencies.environment, { DOCKER_TLS_VERIFY: '1' });
  if (fault === 'source') f.options.cliRef = '9'.repeat(40);
  if (fault === 'machine') f.options.machineIdSha256 = '9'.repeat(64);
  if (fault === 'pending')
    writeFileSync(join(f.state, '.tale/deployment-pending.json'), '{}');
  if (fault === 'private-map')
    f.input.environment.OPERATOR_PASSWORD = '🦊'.repeat(2049);
  await expect(
    observeDeployment(f.options, f.input, {
      ...f.dependencies,
      build: () => ({ revision: 'a'.repeat(40), binary: f.binary }),
    }),
  ).rejects.toThrow();
  expect(f.calls).toEqual([]);
});

testPosix.each([
  'native-identity',
  'container',
  'receipt',
  'binary-copy',
  'host-binary',
])(
  'refuses %s drift and removes only the freshly created transfer directory',
  async (fault) => {
    const f = fixture();
    if (fault === 'native-identity')
      f.setNative({
        ...f.native,
        identity: { ...f.native.identity, userId: 'foreign' },
      });
    f.hook((args) => {
      if (args.includes('observe-native') && fault === 'container')
        f.containers[0].restartCount++;
      if (args.includes('observe-native') && fault === 'receipt')
        writeFileSync(
          f.ready,
          JSON.stringify({ ...f.proof, bundleSha256: 'f'.repeat(64) }),
        );
      if (args.includes('sha256sum') && fault === 'binary-copy')
        throw Error('synthetic secret');
      if (args.includes('observe-native') && fault === 'host-binary')
        writeFileSync(f.binary, 'changed executable');
    });
    await expect(
      observeDeployment(f.options, f.input, f.dependencies),
    ).rejects.toThrow();
    expect(f.calls.filter(({ args }) => args.includes('rm'))).toHaveLength(1);
  },
);

testPosix.each([false, true])(
  'unlabeled support images remain facts; missing backend source is partial (%s)',
  async (missingBackend) => {
    const f = fixture();
    f.containers[0].image = `sha256:${'7'.repeat(64)}`;
    const execute: typeof exec = async (command, args, options) => {
      const result = await f.run(command, args, options);
      if (args[0] !== 'image') return result;
      const unlabeled = missingBackend || args.at(-1) === f.containers[0].image;
      return {
        ...result,
        stdout: JSON.stringify({
          id: args.at(-1),
          revision: unlabeled ? '' : f.proof.revision,
          version: unlabeled ? '' : '0.5.76',
          architecture: 'amd64',
          os: 'linux',
        }),
      };
    };
    const report = await observeDeployment(f.options, f.input, {
      ...f.dependencies,
      exec: execute,
    });
    expect(report.complete).toBe(!missingBackend);
    expect(
      report.images.find((image) => image.id === f.containers[0].image)
        ?.revision,
    ).toBeNull();
    if (missingBackend)
      expect(report.runtimeSource).toEqual({
        status: 'unavailable',
        reason: 'runtime_source_missing',
      });
  },
);

testPosix(
  'uncertain tooling cleanup is explicit and does not expose Docker stderr',
  async () => {
    const f = fixture();
    f.hook((args) => {
      if (args.includes('rm')) throw Error('synthetic private Docker stderr');
    });
    const error = await observeDeployment(
      f.options,
      f.input,
      f.dependencies,
    ).catch((failure: unknown) => failure);
    expect(String(error)).toContain('tooling cleanup could not be verified');
    expect(String(error)).not.toContain('synthetic private');
  },
);

testPosix.each([
  ['containers', 'ps'],
  ['application', '1'.repeat(64)],
  ['knowledge', '2'.repeat(64)],
  ['images', 'image'],
  ['tooling', 'mkdir'],
] as const)(
  'a refused %s phase remains distinguishable without private command output',
  async (phase, trigger) => {
    const f = fixture();
    f.hook((args) => {
      if (
        trigger.length === 64
          ? args.includes('sh') && args[2] === trigger
          : args.includes(trigger)
      )
        throw Error('synthetic-private-output');
    });
    const error = await observeDeployment(
      f.options,
      f.input,
      f.dependencies,
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ObservationPhaseError);
    expect((error as ObservationPhaseError).phase).toBe(phase);
    expect(JSON.stringify(error)).not.toContain('synthetic-private-output');
    expect((error as ObservationPhaseError).info.cause).toBeUndefined();
  },
);

testPosix.each([false, true])(
  'nested native refusal preserves its authored phase and still cleans tooling (%s)',
  async (cleanupFails) => {
    const f = fixture();
    if (cleanupFails)
      f.hook((args) => {
        if (args.includes('rm')) throw Error('synthetic-private-cleanup');
      });
    const execute: typeof exec = async (command, args, options) => {
      const result = await f.run(command, args, options);
      if (!args.includes('observe-native')) return result;
      return {
        ...result,
        exitCode: 3,
        success: false,
        stdout: JSON.stringify({
          ok: false,
          command: 'tale',
          error: new ObservationPhaseError('nativeArtifacts').info,
        }),
      };
    };
    const error = await observeDeployment(f.options, f.input, {
      ...f.dependencies,
      exec: execute,
    }).catch((failure: unknown) => failure);
    expect(String(error)).toContain(
      cleanupFails
        ? 'tooling cleanup could not be verified'
        : 'retained native artifact verification',
    );
    expect(f.calls.filter(({ args }) => args.includes('rm'))).toHaveLength(1);
    expect(JSON.stringify(error)).not.toContain('synthetic-private');
  },
);

testPosix(
  'unknown nested native payload is replaced with an authored refusal after cleanup',
  async () => {
    const f = fixture();
    const execute: typeof exec = async (command, args, options) => {
      const result = await f.run(command, args, options);
      if (!args.includes('observe-native')) return result;
      return {
        ...result,
        exitCode: 3,
        success: false,
        stdout: JSON.stringify({
          ok: false,
          command: 'tale',
          error: {
            summary: 'synthetic-private-error',
            code: 3,
            cause: '/synthetic-private-path',
          },
        }),
      };
    };
    const error = await observeDeployment(f.options, f.input, {
      ...f.dependencies,
      exec: execute,
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ObservationPhaseError);
    expect((error as ObservationPhaseError).phase).toBe('native');
    expect(JSON.stringify(error)).not.toContain('synthetic-private');
    expect(f.calls.filter(({ args }) => args.includes('rm'))).toHaveLength(1);
  },
);
