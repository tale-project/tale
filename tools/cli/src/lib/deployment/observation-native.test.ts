import { expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative as relativePath } from 'node:path';

import { z } from 'zod';

import type { NativeFetch } from '../config/native-http';
import { verifyArtifactBytes } from '../config/releases/artifacts';
import type { DeployOptions } from '../config/releases/deploy';
import { loadClient, sha256 } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { stageRelease } from '../config/releases/stage';
import { fixture, temporary } from '../config/releases/tests/fixture';
import { nativeServer } from '../config/releases/tests/native-fixture';
import { ObservationPhaseError } from './observation-errors';
import { observeNativeDeployment } from './observation-native';
import { nativeDeploymentStateDirectory } from './provision-state';
const testPosix = test.skipIf(process.platform === 'win32');

function snapshot(directory: string, relative = ''): Record<string, string> {
  return Object.fromEntries(
    readdirSync(join(directory, relative), { withFileTypes: true }).flatMap(
      (entry) => {
        const file = join(relative, entry.name);
        return entry.isDirectory()
          ? Object.entries(snapshot(directory, file))
          : [[file, sha256(readFileSync(join(directory, file)))]];
      },
    ),
  );
}
async function retained() {
  const f = fixture('north-labs', ['invoice'], []);
  const dataDirectory = realpathSync(temporary());
  const stateDirectory = nativeDeploymentStateDirectory(dataDirectory, 'north');
  const stageDirectory = join(stateDirectory, 'compiled', 'retained');
  mkdirSync(stageDirectory, { recursive: true, mode: 0o700 });
  const stage = await stageRelease({
    repoRoot: f.root,
    descriptorPath: relativePath(f.root, f.descriptorPath),
    automationName: f.name,
    configRef: f.options.sourceCommit,
    catalogueCommit: f.options.sourceCommit,
    catalogueRepository: f.descriptor.sourceRepository,
    clientId: 'north-labs',
    output: stageDirectory,
    skillOwnerUserId: f.options.skillOwnerUserId,
    validateNative: verifyArtifactBytes,
  });
  const release = loadRelease(
    join(stageDirectory, stage.manifestPath),
    loadClient(join(stageDirectory, 'client.json'), f.name),
  );
  const nativeOptions: DeployOptions = {
    descriptorPath: join(stageDirectory, 'client.json'),
    manifestPath: join(stageDirectory, stage.manifestPath),
    automationName: f.name,
    url: 'http://127.0.0.1:3005',
    origin: 'https://north.example',
    orgId: 'org-north',
    projectId: 'project-north',
    cookie: 'session=synthetic-session',
  };
  const server = await nativeServer(release, nativeOptions);
  server.exists = true;
  server.deployed = 7;
  for (const slug of release.manifest.skillSlugs) server.installed.add(slug);
  const receipt = {
    schemaVersion: 2,
    target: {
      origin: nativeOptions.origin,
      orgId: nativeOptions.orgId,
      projectId: nativeOptions.projectId,
      automationName: f.name,
    },
    sourceCommit: f.options.sourceCommit,
    releaseRef: f.options.sourceCommit,
    artifactSha256: release.manifest.artifact.sha256,
    automationVersion: 7,
  };
  const receiptDirectory = join(stateDirectory, 'north-labs');
  mkdirSync(receiptDirectory, { mode: 0o700 });
  const receiptFile = join(receiptDirectory, `${f.name}.json`);
  writeFileSync(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
  const input = {
    schemaVersion: 1,
    cliRevision: 'a'.repeat(40),
    cliSha256: 'b'.repeat(64),
    target: {
      name: 'north',
      origin: 'https://north.example',
      organizationId: 'org-north',
      organizationSlug: 'north',
      organizationName: 'North',
      userId: 'native_owner_test',
    },
    operator: {
      email: 'operator@example.invalid',
      password: 'synthetic-password',
    },
  };
  let active = false;
  const auth: string[] = [];
  const fetcher: NativeFetch = async (value, init) => {
    const url = new URL(String(value));
    if (url.pathname.startsWith('/api/auth/')) {
      auth.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/api/auth/sign-in/email')
        return Response.json(
          {},
          { headers: { 'set-cookie': 'session=synthetic-session; Path=/' } },
        );
      if (url.pathname === '/api/auth/sign-out')
        return Response.json({ success: !server.faults.has('failedLogout') });
      if (url.pathname === '/api/auth/get-session')
        return Response.json({
          user: { id: 'native_owner_test', email: input.operator.email },
          session: {
            userId: 'native_owner_test',
            activeOrganizationId: active ? 'org-north' : null,
          },
        });
      if (url.pathname === '/api/auth/organization/list')
        return Response.json([{ id: 'org-north', slug: 'north' }]);
      if (url.pathname === '/api/auth/organization/set-active') {
        active = true;
        return Response.json({ id: 'org-north' });
      }
      throw Error('unexpected auth write');
    }
    const response = await nativeOptions.fetchImpl!(url, init!);
    if (
      release.manifest.skillSlugs.some(
        (slug) => url.pathname === `/api/app/skills/${slug}`,
      )
    ) {
      const body = z
        .object({ skill: z.looseObject({ owner: z.string().optional() }) })
        .parse(await response.json());
      body.skill.owner = server.faults.has('missingOwner')
        ? undefined
        : server.faults.has('foreignOwner')
          ? 'foreign-owner'
          : 'native_owner_test';
      return Response.json(body, { status: response.status });
    }
    return response;
  };
  return {
    input,
    dataDirectory,
    stateDirectory,
    stageDirectory,
    receiptFile,
    receipt,
    release,
    server,
    auth,
    fetcher,
  };
}

testPosix(
  'observes a retained pack through the real native verifier without modifying its state or assets',
  async () => {
    const f = await retained();
    const before = snapshot(f.dataDirectory);
    const observed = await observeNativeDeployment(f.input, {
      dataDirectory: f.dataDirectory,
      fetch: f.fetcher,
    });
    expect(observed.status).toBe('observed');
    if (observed.status !== 'observed') throw Error('missing observation');
    expect(observed.configurations).toEqual([
      expect.objectContaining({
        automationVersion: 7,
        workflowSha256: f.release.manifest.documentSha256,
        custodyOwnerUserId: 'native_owner_test',
      }),
    ]);
    expect(snapshot(f.dataDirectory)).toEqual(before);
    expect(f.server.requests.every((call) => call.method === 'GET')).toBe(true);
    expect([
      f.server.imports,
      f.server.deploys,
      f.server.skillCreates,
      f.server.uploads,
    ]).toEqual([0, 0, 0, 0]);
    expect(f.auth).toEqual([
      'POST /api/auth/sign-in/email',
      'GET /api/auth/get-session',
      'GET /api/auth/organization/list',
      'POST /api/auth/organization/set-active',
      'GET /api/auth/get-session',
      'POST /api/auth/sign-out',
    ]);
    expect(JSON.stringify(observed)).not.toContain('synthetic-password');
    expect(JSON.stringify(observed)).not.toContain('synthetic-session');
  },
);

testPosix.each([
  ['receipt', 'nativeRetained'],
  ['artifact', 'nativeArtifacts'],
  ['authentication', 'nativeAuthentication'],
  ['verification', 'nativeVerification'],
] as const)(
  'native %s refusal identifies its actual phase without private values',
  async (fault, phase) => {
    const f = await retained();
    if (fault === 'receipt') chmodSync(f.receiptFile, 0o644);
    if (fault === 'artifact')
      writeFileSync(
        join(f.stageDirectory, 'deployment.json'),
        'synthetic-private-artifact',
      );
    if (fault === 'verification') f.server.faults.add('wrongWorkflow');
    const error = await observeNativeDeployment(f.input, {
      dataDirectory: f.dataDirectory,
      fetch: (url, init) =>
        fault === 'authentication' &&
        new URL(String(url)).pathname === '/api/auth/sign-in/email'
          ? Promise.resolve(
              Response.json(
                { error: 'synthetic-private-response' },
                { status: 403 },
              ),
            )
          : f.fetcher(url, init),
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ObservationPhaseError);
    expect((error as ObservationPhaseError).phase).toBe(phase);
    expect((error as ObservationPhaseError).info.code).toBe(3);
    expect(JSON.stringify(error)).not.toContain('synthetic-private');
    expect(JSON.stringify(error)).not.toContain('synthetic-password');
    expect((error as ObservationPhaseError).info.cause).toBeUndefined();
  },
);

testPosix(
  'missing retained state stays missing and never signs in or bootstraps',
  async () => {
    const f = await retained();
    const absent = join(f.dataDirectory, 'absent');
    expect(
      await observeNativeDeployment(f.input, {
        dataDirectory: absent,
        fetch: f.fetcher,
      }),
    ).toEqual({ status: 'unavailable', reason: 'retained_state_missing' });
    expect(f.auth).toEqual([]);
    expect(readdirSync(f.dataDirectory)).not.toContain('absent');
  },
);

testPosix.each([
  'foreign-org',
  'foreign-owner',
  'symlink',
  'exposed-receipt',
  'corrupt-stage',
  'duplicate-stage',
])('refuses %s custody before authentication', async (fault) => {
  const f = await retained();
  if (fault === 'foreign-org') f.input.target.organizationId = 'another-org';
  if (fault === 'foreign-owner') f.input.target.userId = 'another-owner';
  if (fault === 'symlink')
    symlinkSync(f.stageDirectory, join(f.stateDirectory, 'foreign'));
  if (fault === 'exposed-receipt') chmodSync(f.receiptFile, 0o644);
  if (fault === 'corrupt-stage')
    writeFileSync(join(f.stageDirectory, 'client.json'), '{}');
  if (fault === 'duplicate-stage') {
    const duplicate = join(f.stateDirectory, 'compiled', 'duplicate');
    mkdirSync(duplicate, { mode: 0o700 });
    writeFileSync(
      join(duplicate, 'deployment.json'),
      readFileSync(join(f.stageDirectory, 'deployment.json')),
      { mode: 0o600 },
    );
  }
  await expect(
    observeNativeDeployment(f.input, {
      dataDirectory: f.dataDirectory,
      fetch: f.fetcher,
    }),
  ).rejects.toThrow();
  expect(f.auth).toEqual([]);
});

testPosix.each([
  'wrongWorkflow',
  'corruptFile',
  'missingBinding',
  'changedPresentation',
  'foreignOwner',
])(
  'native %s refuses without an upload or leaked response and signs out',
  async (fault) => {
    const f = await retained();
    f.server.faults.add(fault);
    await expect(
      observeNativeDeployment(f.input, {
        dataDirectory: f.dataDirectory,
        fetch: f.fetcher,
      }),
    ).rejects.toThrow('native configuration verification');
    expect(f.auth.at(-1)).toBe('POST /api/auth/sign-out');
    expect(f.server.requests.every((call) => call.method === 'GET')).toBe(true);
  },
);

testPosix(
  'refuses a pointer or receipt changed during asset reads',
  async () => {
    for (const kind of ['pointer', 'receipt']) {
      const f = await retained();
      const fetcher: NativeFetch = async (url, init) => {
        const response = await f.fetcher(url, init);
        if (String(url).includes('/assets/')) {
          if (kind === 'pointer') f.server.deployed = 8;
          else
            writeFileSync(
              f.receiptFile,
              JSON.stringify({ ...f.receipt, automationVersion: 8 }),
            );
        }
        return response;
      };
      await expect(
        observeNativeDeployment(f.input, {
          dataDirectory: f.dataDirectory,
          fetch: fetcher,
        }),
      ).rejects.toThrow();
      expect(f.auth.at(-1)).toBe('POST /api/auth/sign-out');
    }
  },
);

testPosix(
  'missing live ownership produces partial evidence after verification and session cleanup',
  async () => {
    const f = await retained();
    f.server.faults.add('missingOwner');
    expect(
      await observeNativeDeployment(f.input, {
        dataDirectory: f.dataDirectory,
        fetch: f.fetcher,
      }),
    ).toEqual({ status: 'unavailable', reason: 'native_owner_unavailable' });
    expect(f.auth.at(-1)).toBe('POST /api/auth/sign-out');
    expect(f.server.requests.every((call) => call.method === 'GET')).toBe(true);
  },
);

testPosix(
  'missing matching stage reports unavailable without inventing an owner or compiling a replacement',
  async () => {
    const f = await retained();
    rmSync(f.stageDirectory, { recursive: true });
    expect(
      await observeNativeDeployment(f.input, {
        dataDirectory: f.dataDirectory,
        fetch: f.fetcher,
      }),
    ).toEqual({ status: 'unavailable', reason: 'retained_stage_missing' });
    expect(f.auth).toEqual([]);
    expect(readdirSync(join(f.stateDirectory, 'compiled'))).toEqual([]);
  },
);

testPosix(
  'failed sign-out remains an explicit authored cleanup failure',
  async () => {
    const f = await retained();
    f.server.faults.add('failedLogout');
    await expect(
      observeNativeDeployment(f.input, {
        dataDirectory: f.dataDirectory,
        fetch: f.fetcher,
      }),
    ).rejects.toThrow('authentication session cleanup could not be verified');
    expect(f.server.requests.every((call) => call.method === 'GET')).toBe(true);
  },
);
