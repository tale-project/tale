import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256, stableJson } from '../config/releases/identity';
import type { exec } from '../docker/exec';
import { acquireLock } from '../state/acquire-lock';
import { releaseLock } from '../state/release-lock';
import { writeDeploymentBundle } from './bundle';
import { exportManagedClient } from './client-export';
import { verifyClientExportDirectory } from './client-export-files';
import {
  clientExportTargetSchema,
  type ClientExportTarget,
} from './client-export-model';
import { exportNativeClient } from './client-export-native';
import { deploymentSpecSchema } from './model';
import { intentSchema } from './native-client';
import {
  nativeDeploymentStateDirectory,
  provisionStatePath,
  writeProvisionState,
} from './provision-state';
import { applyRuntime } from './runtime-apply';
import { prepareRuntime } from './runtime-prepare';
import {
  RuntimeDockerFixture,
  runtimeFixture,
  type RuntimeFixture,
} from './runtime-test-helper';

const fixtures: RuntimeFixture[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0))
    rmSync(f.directory, { recursive: true, force: true });
});
async function fixture(
  team = 'north',
  selection: {
    emailReference?: boolean;
    withoutDeploymentRef?: boolean;
    attestation?: boolean;
  } = {},
) {
  const f = runtimeFixture();
  fixtures.push(f);
  const docker = new RuntimeDockerFixture(f);
  const bundle = join(f.directory, 'deployment');
  mkdirSync(join(bundle, 'cli'), { recursive: true });
  writeFileSync(join(bundle, 'cli/tale'), 'frozen executable', { mode: 0o755 });
  f.options.bundleDirectory = join(bundle, 'runtime');
  await prepareRuntime(
    {
      repoRoot: f.repoRoot,
      revision: f.revision,
      output: f.options.bundleDirectory,
      platform: 'linux/amd64',
    },
    docker.dependencies(),
  );
  await applyRuntime(f.options, docker.dependencies());
  const clients = ['portal', 'reports'].map((key) => ({
    key,
    name: `${team} ${key}`,
    managed: true as const,
    redirectUris: [`https://${key}.${team}.example.invalid/auth/callback`],
  }));
  const email = `operator@${team}.example.invalid`;
  const sourcePin = selection.withoutDeploymentRef
    ? {}
    : { deploymentRef: 'c'.repeat(40) };
  const attestationDeclaration = selection.attestation
    ? { emailVerification: 'operator-attested' as const }
    : {};
  const spec = deploymentSpecSchema.parse({
    schemaVersion: 1,
    name: f.options.name,
    stateDirectory: f.options.stateDirectory,
    composeProject: f.options.composeProject,
    origin: f.options.origin,
    tlsMode: 'external',
    runtime: { revision: f.revision },
    identity: {
      bootstrap: 'fresh',
      email: selection.emailReference
        ? { env: 'DECLARED_OPERATOR_EMAIL' }
        : email,
      ...attestationDeclaration,
      slug: team,
      name: team,
      ssoEnabled: false,
      nativeClients: clients,
    },
  });
  await writeDeploymentBundle(bundle, {
    schemaVersion: 1,
    kind: 'tale-deployment',
    cli: { revision: 'a'.repeat(40), path: 'cli/tale' },
    ...sourcePin,
    spec,
  });
  const data = join(f.directory, 'native-data');
  mkdirSync(data, { mode: 0o700 });
  const state = nativeDeploymentStateDirectory(data, spec.name);
  writeProvisionState(
    provisionStatePath(state, 'bootstrap.json', true),
    {
      schemaVersion: 1,
      phase: 'ready',
      origin: spec.origin,
      email,
      ...attestationDeclaration,
      slug: team,
      name: team,
      userId: `operator-${team}`,
      organizationId: `org-${team}`,
      signupAttempted: true,
      organizationCreateAttempted: true,
    },
    true,
  );
  const emailProof = selection.attestation
    ? {
        emailVerification: {
          method: 'operator-attested' as const,
          userId: `operator-${team}`,
          email,
          emailVerified: true as const,
          receipt: writeProvisionState(
            provisionStatePath(state, 'email-attestation.json', true),
            {
              schemaVersion: 1,
              phase: 'ready',
              method: 'operator-attested',
              origin: spec.origin,
              userId: `operator-${team}`,
              email,
            },
            true,
          ),
        },
      }
    : {};
  const intents = clients.map((client, index) =>
    intentSchema.parse({
      schemaVersion: 1,
      phase: 'ready',
      origin: spec.origin,
      organizationId: `org-${team}`,
      operatorUserId: `operator-${team}`,
      body: {
        client_name: client.name,
        software_id: client.key,
        redirect_uris: client.redirectUris,
        scope: 'openid profile email tale:organization',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        type: 'web',
        require_pkce: true,
        skip_consent: false,
        metadata: { taleOrganizationId: `org-${team}` },
      },
      credentials: {
        clientId: `${team}-${client.key}`,
        clientSecret: (index ? 'b' : 'a').repeat(43),
      },
    }),
  );
  const proofs = intents.map((intent) =>
    writeProvisionState(
      provisionStatePath(state, `client-${intent.body.software_id}.json`, true),
      intent,
      true,
    ),
  );
  const runtime = JSON.parse(
    readFileSync(join(f.options.stateDirectory, '.tale/runtime.json'), 'utf8'),
  );
  const ready = {
    schemaVersion: 1,
    phase: 'ready',
    name: spec.name,
    revision: f.revision,
    cliRevision: 'a'.repeat(40),
    ...sourcePin,
    bundleSha256: sha256(readFileSync(join(bundle, 'deployment.json'))),
    images: runtime.images,
    configs: [],
    native: {
      ...emailProof,
      organizationId: `org-${team}`,
      organizationSlug: team,
      userId: `operator-${team}`,
      ssoEnabled: false,
      nativeClients: intents.map((intent, index) => ({
        key: intent.body.software_id,
        clientId: intent.credentials.clientId,
        changed: true,
        credentials: {
          path: `/app/data/ops/tale-deployments/${spec.name}/private/client-${intent.body.software_id}.json`,
          sha256: proofs[index].sha256,
        },
      })),
      configs: [],
    },
  };
  const readyFile = join(
    f.options.stateDirectory,
    '.tale/deployment-ready.json',
  );
  writeFileSync(readyFile, JSON.stringify(ready, null, 2) + '\n', {
    mode: 0o600,
  });
  const parent = join(f.directory, 'exports');
  mkdirSync(parent, { mode: 0o700 });
  const options = {
    bundle,
    client: 'portal',
    output: join(parent, 'portal'),
    envPrefix: 'TALE_OIDC',
    cliRef: 'a'.repeat(40),
    ...sourcePin,
  };
  const backendRoot = join(f.directory, 'backend-transport');
  mkdirSync(backendRoot, { mode: 0o700 });
  const mapped = (path: string) =>
    join(backendRoot, path.replace(/^\/tmp\//, ''));
  let verifyCount = 0;
  let alter: ((target: ClientExportTarget) => void) | undefined;
  let onTransport: (() => void) | undefined;
  let lost = false;
  const verify = async (
    target: ClientExportTarget,
    intent: (typeof intents)[number],
  ) => {
    verifyCount++;
    alter?.(target);
    const index = clients.findIndex((c) => c.key === target.client.key);
    expect(index).toBeGreaterThanOrEqual(0);
    if (
      target.organization.id !== `org-${team}` ||
      target.userId !== `operator-${team}` ||
      stableJson(target.client.redirectUris) !==
        stableJson(clients[index].redirectUris) ||
      stableJson(intent.credentials) !== stableJson(intents[index].credentials)
    )
      throw Error('synthetic native mismatch');
    return sha256(stableJson({ intent: intents[index], target }));
  };
  const executed: { args: string[]; stdin?: string }[] = [];
  const run: typeof exec = async (command, args, execOptions) => {
    expect(command).toBe('docker');
    executed.push({ args, stdin: execOptions?.stdin });
    expect(execOptions?.silent).toBe(true);
    expect(execOptions?.env).not.toHaveProperty('TALE_TEST_UNUSED_SECRET');
    const ok = (value = '') => ({
      success: true,
      stdout: value,
      stderr: '',
      exitCode: 0,
    });
    if (args[0] === 'exec' && args[2] === 'stat') return ok('1001:1001\n');
    if (args[0] === 'exec' && args[2] === 'chown') return ok();
    if (args[0] === 'exec' && args[2] === 'mkdir') {
      mkdirSync(mapped(args.at(-1)!), { mode: 0o700 });
      return ok();
    }
    if (args[0] === 'exec' && args[2] === 'rm') {
      rmSync(mapped(args.at(-1)!), { recursive: true, force: true });
      return ok();
    }
    if (args[0] === 'cp') {
      const [source, destination] = args.slice(1);
      if (source.includes(':/tmp/'))
        cpSync(
          mapped(source.slice(source.indexOf(':') + 1).replace(/\/\.$/, '')),
          destination,
          { recursive: true },
        );
      else {
        cpSync(
          source.replace(/\/\.$/, ''),
          mapped(
            destination.slice(destination.indexOf(':') + 1).replace(/\/$/, ''),
          ),
          { recursive: true },
        );
        onTransport?.();
      }
      return ok();
    }
    if (args[0] === 'exec' && args.includes('export-client-native')) {
      const selected = clientExportTargetSchema.parse(
        JSON.parse(execOptions?.stdin ?? ''),
      );
      const nativeBundle = args[args.indexOf('--bundle') + 1];
      const output = args[args.indexOf('--output') + 1];
      const result = await exportNativeClient(
        mapped(nativeBundle),
        selected,
        mapped(output),
        { dataDirectory: data, verify },
      );
      if (lost) throw Error('synthetic accepted-response loss');
      return ok(
        JSON.stringify({
          ok: true,
          command: 'deploy export-client-native',
          data: { ...result, directory: output },
        }),
      );
    }
    return docker.execute(command, args, execOptions);
  };
  docker.calls = [];
  return {
    f,
    bundle,
    spec,
    clients,
    intents,
    proofs,
    state,
    data,
    ready,
    readyFile,
    options,
    parent,
    run,
    executed,
    verify,
    get verifyCount() {
      return verifyCount;
    },
    set alter(value: typeof alter) {
      alter = value;
    },
    set onTransport(value: typeof onTransport) {
      onTransport = value;
    },
    set lost(value: boolean) {
      lost = value;
    },
  };
}
const describePosix = describe.skipIf(process.platform === 'win32');
describePosix('managed native client consumer export', () => {
  test('default OS temp path without TMPDIR keeps export and receive custody canonical', async () => {
    const saved = Object.fromEntries(
      ['TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
    );
    for (const key of Object.keys(saved)) delete process.env[key];
    try {
      expect(tmpdir()).toBe('/tmp');
      const f = await fixture();
      expect(f.options.output.startsWith('/tmp/')).toBe(true);
      const first = await exportManagedClient(f.options, { exec: f.run });
      expect(first.unchanged).toBe(false);
      expect(
        (await exportManagedClient(f.options, { exec: f.run })).unchanged,
      ).toBe(true);
      const canonicalOptions = {
        ...f.options,
        output: join(realpathSync(f.parent), 'canonical'),
      };
      expect(
        (await exportManagedClient(canonicalOptions, { exec: f.run }))
          .unchanged,
      ).toBe(false);
      const received = f.executed.filter(
        (call) => call.args[0] === 'cp' && call.args[1].includes(':/tmp/'),
      );
      expect(received).toHaveLength(3);
      for (const call of received)
        expect(call.args[2].startsWith(realpathSync(tmpdir()) + '/')).toBe(
          true,
        );
      const alias = join(f.parent, 'custom-temp-alias');
      symlinkSync(f.parent, alias);
      await expect(
        exportManagedClient(
          { ...f.options, output: join(alias, 'unexpected') },
          { exec: f.run },
        ),
      ).rejects.toThrow();
      expect(existsSync(join(f.parent, 'unexpected'))).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('two generic organizations and two clients export only the selected immutable credentials; replay does not rotate', async () => {
    for (const name of ['north', 'south']) {
      const f = await fixture(name);
      const before = f.proofs.map((p) => readFileSync(p.path));
      for (const key of ['portal', 'reports']) {
        const options = {
          ...f.options,
          client: key,
          output: join(f.parent, key),
        };
        const first = await exportManagedClient(options, { exec: f.run });
        expect(first.unchanged).toBe(false);
        expect(first.receipt.target.client.key).toBe(key);
        const content = JSON.parse(
          readFileSync(join(options.output, 'client.json'), 'utf8'),
        );
        expect(content.clientId).toBe(`${name}-${key}`);
        const env = JSON.parse(
          readFileSync(join(options.output, 'consumer-env.json'), 'utf8'),
        );
        expect(env).toEqual({
          TALE_OIDC_ISSUER: `${f.spec.origin}/api/auth`,
          TALE_OIDC_CLIENT_ID: content.clientId,
          TALE_OIDC_CLIENT_SECRET: content.clientSecret,
          TALE_OIDC_ORG_SLUG: name,
        });
        const old = readFileSync(join(options.output, 'client.json'));
        const repeat = await exportManagedClient(options, { exec: f.run });
        expect(repeat.unchanged).toBe(true);
        expect(readFileSync(join(options.output, 'client.json'))).toEqual(old);
        expect(JSON.stringify(first)).not.toContain(content.clientSecret);
        expect(first.receipt.files).toHaveLength(2);
      }
      expect(f.proofs.map((p) => readFileSync(p.path))).toEqual(before);
      expect(f.verifyCount).toBe(8);
      expect(
        f.executed.some((c) => ['pull', 'tag', 'compose'].includes(c.args[0])),
      ).toBe(false);
    }
  });
  test.each([
    { emailReference: true, withoutDeploymentRef: false, attestation: false },
    { emailReference: false, withoutDeploymentRef: true, attestation: false },
    { emailReference: true, withoutDeploymentRef: true, attestation: false },
    { emailReference: true, withoutDeploymentRef: false, attestation: true },
  ])(
    'literal-free optional inputs remain exportable using retained bootstrap identity: %j',
    async (selection) => {
      const f = await fixture('north', selection);
      const { envPrefix: _envPrefix, ...options } = f.options;
      const first = await exportManagedClient(options, { exec: f.run });
      expect(first.receipt.files.map((file) => file.path)).toEqual([
        'client.json',
      ]);
      expect(existsSync(join(options.output, 'consumer-env.json'))).toBe(false);
      expect(first.receipt.target.deployment.deploymentRef).toBe(
        selection.withoutDeploymentRef ? undefined : 'c'.repeat(40),
      );
      expect(first.receipt.target.email).toBe(
        selection.emailReference && !selection.attestation
          ? undefined
          : 'operator@north.example.invalid',
      );
      expect(first.receipt.target.emailVerification?.method).toBe(
        selection.attestation ? 'operator-attested' : undefined,
      );
      const repeat = await exportManagedClient(options, { exec: f.run });
      expect(repeat.unchanged).toBe(true);
    },
  );
  test.each([
    'pending',
    'foreign-user',
    'foreign-email',
    'changed-proof',
    'foreign-path',
  ])('export refuses %s administrative attestation proof', async (change) => {
    const f = await fixture('north', { attestation: true });
    const file = provisionStatePath(f.state, 'email-attestation.json');
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (change === 'pending') value.phase = 'pending';
    if (change === 'foreign-user') value.userId = 'foreign';
    if (change === 'foreign-email') value.email = 'foreign@example.invalid';
    if (change === 'changed-proof')
      value.origin = 'https://foreign.example.invalid';
    if (change === 'foreign-path')
      f.ready.native.emailVerification!.receipt.path = '/foreign/receipt.json';
    else writeProvisionState(file, value);
    writeFileSync(f.readyFile, JSON.stringify(f.ready));
    await expect(
      exportManagedClient(f.options, { exec: f.run }),
    ).rejects.toThrow();
    expect(existsSync(f.options.output)).toBe(false);
  });
  test.each([
    'pending',
    'wrong-bundle',
    'wrong-cli',
    'wrong-ops',
    'foreign-org',
    'foreign-user',
    'foreign-client',
    'foreign-path',
    'missing-credentials',
    'no-ready',
  ])('refuses %s before output or native writes', async (change) => {
    const f = await fixture();
    const before = f.proofs.map((p) => readFileSync(p.path));
    if (change === 'pending')
      writeFileSync(
        join(f.f.options.stateDirectory, '.tale/deployment-pending.json'),
        '{}',
      );
    if (change === 'wrong-bundle') f.ready.bundleSha256 = 'd'.repeat(64);
    if (change === 'wrong-cli') f.ready.cliRevision = 'd'.repeat(40);
    if (change === 'wrong-ops') f.ready.deploymentRef = 'd'.repeat(40);
    if (change === 'foreign-org') f.ready.native.organizationId = 'foreign';
    if (change === 'foreign-user') f.ready.native.userId = 'foreign';
    if (change === 'foreign-client')
      f.ready.native.nativeClients[0].clientId = 'foreign';
    if (change === 'foreign-path')
      f.ready.native.nativeClients[0].credentials.path = '/etc/passwd';
    if (change === 'missing-credentials')
      delete (f.ready.native.nativeClients[0] as { credentials?: unknown })
        .credentials;
    writeFileSync(f.readyFile, JSON.stringify(f.ready));
    if (change === 'no-ready') rmSync(f.readyFile);
    await expect(
      exportManagedClient(f.options, { exec: f.run }),
    ).rejects.toThrow();
    expect(existsSync(f.options.output)).toBe(false);
    expect(f.proofs.map((p) => readFileSync(p.path))).toEqual(before);
  });
  test.each([
    'intent-hash',
    'intent-pending',
    'bootstrap-pending',
    'secret-rotated',
    'callback-drift',
    'native-reread',
    'ready-during-copy',
    'intent-during-read',
  ])('refuses %s instead of publishing stale credentials', async (change) => {
    const f = await fixture();
    if (change === 'intent-hash')
      writeFileSync(f.proofs[0].path, JSON.stringify(f.intents[0]));
    if (change === 'intent-pending') {
      const value = { ...f.intents[0], phase: 'pending' };
      const proof = writeProvisionState(f.proofs[0].path, value);
      f.ready.native.nativeClients[0].credentials.sha256 = proof.sha256;
    }
    if (change === 'bootstrap-pending') {
      const file = provisionStatePath(f.state, 'bootstrap.json');
      const value = JSON.parse(readFileSync(file, 'utf8'));
      value.phase = 'pending';
      writeProvisionState(file, value);
    }
    if (change === 'secret-rotated')
      f.intents[0].credentials.clientSecret = 'c'.repeat(43);
    if (change === 'callback-drift')
      f.clients[0].redirectUris = ['https://foreign.invalid/callback'];
    if (change === 'native-reread')
      f.alter = (target) => {
        if (f.verifyCount === 2) target.client.name = 'drift';
      };
    if (change === 'ready-during-copy')
      f.onTransport = () =>
        writeFileSync(
          f.readyFile,
          JSON.stringify({ ...f.ready, ignored: 'change' }),
        );
    if (change === 'intent-during-read')
      f.alter = () => {
        if (f.verifyCount === 2)
          writeFileSync(f.proofs[0].path, JSON.stringify(f.intents[0]));
      };
    writeFileSync(f.readyFile, JSON.stringify(f.ready, null, 2) + '\n');
    await expect(
      exportManagedClient(f.options, { exec: f.run }),
    ).rejects.toThrow();
    expect(existsSync(f.options.output)).toBe(false);
  });
  test.each([
    'partial',
    'extra',
    'symlink',
    'hardlink',
    'permissions',
    'credential',
    'env',
    'receipt',
    'stale-ready',
  ])(
    'completed export rejects %s tampering without overwriting',
    async (change) => {
      const f = await fixture();
      await exportManagedClient(f.options, { exec: f.run });
      const file = join(f.options.output, 'client.json');
      if (change === 'partial') rmSync(join(f.options.output, 'receipt.json'));
      if (change === 'extra')
        writeFileSync(join(f.options.output, 'unexpected'), 'x');
      if (change === 'symlink') {
        rmSync(file);
        symlinkSync(f.proofs[0].path, file);
      }
      if (change === 'hardlink') linkSync(file, join(f.parent, 'other-link'));
      if (change === 'permissions') chmodSync(file, 0o644);
      if (change === 'credential') {
        const value = JSON.parse(readFileSync(file, 'utf8'));
        value.clientSecret = 'z'.repeat(43);
        writeFileSync(file, JSON.stringify(value));
      }
      if (change === 'env')
        writeFileSync(join(f.options.output, 'consumer-env.json'), '{}');
      if (change === 'receipt')
        writeFileSync(join(f.options.output, 'receipt.json'), '{}');
      if (change === 'stale-ready')
        writeFileSync(
          f.readyFile,
          JSON.stringify({ ...f.ready, changed: false }),
        );
      const before = readFileSync(file);
      await expect(
        exportManagedClient(f.options, { exec: f.run }),
      ).rejects.toThrow();
      expect(readFileSync(file)).toEqual(before);
    },
  );
  test.each([
    'parent-symlink',
    'ancestor-symlink',
    'writable-ancestor',
    'directory-symlink',
    'oversized-private-file',
  ])('private export refuses %s', async (change) => {
    const f = await fixture();
    const untouched = readFileSync(f.proofs[0].path);
    let output = f.options.output;
    if (change === 'parent-symlink') {
      const alias = join(f.f.directory, 'alias');
      symlinkSync(f.parent, alias);
      output = join(alias, 'new');
    }
    if (change === 'ancestor-symlink') {
      const alias = join(f.f.directory, 'alias');
      symlinkSync(f.parent, alias);
      mkdirSync(join(f.parent, 'private'), { mode: 0o700 });
      output = join(alias, 'private', 'new');
    }
    if (change === 'writable-ancestor') {
      const ancestor = join(f.parent, 'writable');
      mkdirSync(ancestor);
      chmodSync(ancestor, 0o777);
      mkdirSync(join(ancestor, 'private'), { mode: 0o700 });
      output = join(ancestor, 'private', 'new');
    }
    if (change === 'directory-symlink') symlinkSync(f.parent, output);
    if (change === 'oversized-private-file') {
      await exportManagedClient(f.options, { exec: f.run });
      writeFileSync(join(output, 'client.json'), ' '.repeat(65537));
    }
    await expect(
      exportManagedClient({ ...f.options, output }, { exec: f.run }),
    ).rejects.toThrow();
    expect(readFileSync(f.proofs[0].path)).toEqual(untouched);
  });
  test('lost backend response never publishes host output; safe repeat re-verifies completed native intent', async () => {
    const f = await fixture();
    const before = readFileSync(f.proofs[0].path);
    f.lost = true;
    await expect(
      exportManagedClient(f.options, { exec: f.run }),
    ).rejects.toThrow();
    expect(existsSync(f.options.output)).toBe(false);
    f.lost = false;
    const result = await exportManagedClient(f.options, { exec: f.run });
    expect(result.unchanged).toBe(false);
    expect(readFileSync(f.proofs[0].path)).toEqual(before);
  });
  test('export is serialized with deployment and native provisioning locks', async () => {
    const f = await fixture();
    for (const state of [f.f.options.stateDirectory, f.state]) {
      expect(await acquireLock(state, 'synthetic concurrent deploy')).toBe(
        true,
      );
      try {
        await expect(
          exportManagedClient(f.options, { exec: f.run }),
        ).rejects.toThrow();
        expect(existsSync(f.options.output)).toBe(false);
      } finally {
        await releaseLock(state);
      }
    }
  });
  test('source changing during transfer cannot replace the frozen executable or credentials', async () => {
    const f = await fixture();
    f.onTransport = () =>
      writeFileSync(join(f.bundle, 'cli/tale'), 'untrusted replacement');
    const actual = await exportManagedClient(f.options, { exec: f.run });
    expect(actual.receipt.target.client.clientId).toBe('north-portal');
    await expect(
      exportManagedClient(
        { ...f.options, output: join(f.parent, 'next') },
        { exec: f.run },
      ),
    ).rejects.toThrow();
  });
  test.each(['portal\n', '../portal', 'foreign'])(
    'unknown or malformed client key %s refuses',
    async (client) => {
      const f = await fixture();
      await expect(
        exportManagedClient({ ...f.options, client }, { exec: f.run }),
      ).rejects.toThrow();
      expect(existsSync(f.options.output)).toBe(false);
    },
  );
  test.each(['PREFIX\n', 'BAD-NAME', 'A=B', ''])(
    'unsafe consumer environment prefix refuses before output',
    async (envPrefix) => {
      const f = await fixture();
      await expect(
        exportManagedClient({ ...f.options, envPrefix }, { exec: f.run }),
      ).rejects.toThrow();
      expect(f.executed).toHaveLength(0);
    },
  );
  test('missing native state and incomplete output cannot create or adopt native state', async () => {
    const f = await fixture();
    const first = await exportManagedClient(f.options, { exec: f.run });
    const target = first.receipt.target;
    const missing = join(f.f.directory, 'absent-data');
    await expect(
      exportNativeClient(f.bundle, target, join(f.parent, 'native-output'), {
        dataDirectory: missing,
        verify: f.verify,
      }),
    ).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
    const partial = join(f.parent, 'partial');
    mkdirSync(partial, { mode: 0o700 });
    expect(() => verifyClientExportDirectory(partial, target)).toThrow();
    await expect(
      exportNativeClient(f.bundle, target, partial, {
        dataDirectory: f.data,
        verify: f.verify,
      }),
    ).rejects.toThrow();
    expect(readdirSync(partial)).toEqual([]);
  });
});
