import { existsSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { z } from 'zod';

import {
  providerKeyEnvNameSchema,
  SECRETS_ENV_PREFIX,
} from '../../../../../services/platform/lib/shared/schemas/providers';
import { preconditionError, externalDepError } from '../../utils/fail';
import { sha256, valueHash } from '../config/releases/identity';
import { sha } from '../config/releases/model';
import { ownedDirectory } from '../inference/files';
import { admittedProofs } from '../inference/router';
import { inferenceApiKey } from '../inference/settings';
import {
  INFERENCE_IMAGES,
  inferenceProject,
  inferenceTopology,
  verifyManagedInference,
} from './inference';
import { resolveValue, type DeploymentSpec } from './model';
import { runtimeCommand, runtimeSleep } from './runtime-command';
import { parseRuntimeEnvironment } from './runtime-env';
import {
  atomicRuntimeFile,
  readRegular,
  type RuntimeDependencies,
} from './runtime-model';
import { inspectRuntimeImage } from './runtime-prepare';

const fileNames = ['compose.yml', 'Caddyfile', '.env'] as const;
const hashes = z.strictObject({
  'compose.yml': sha,
  Caddyfile: sha,
  '.env': sha,
});
const nullableHashes = z.strictObject({
  'compose.yml': sha.nullable(),
  Caddyfile: sha.nullable(),
  '.env': sha.nullable(),
});
const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('tale-inference-router'),
  phase: z.enum(['pending', 'ready']),
  name: z.string(),
  composeProject: z.string(),
  companionSha256: sha,
  inputSha256: sha,
  stage: sha,
  previousStage: sha.optional(),
  identityVolumeSha256: sha.optional(),
  files: hashes,
  before: nullableHashes,
});
type Receipt = z.infer<typeof receiptSchema>;
const containerSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{12,64}$/),
  Name: z.string(),
  Config: z.object({
    Image: z.string(),
    Labels: z.record(z.string(), z.string()),
    Env: z.array(z.string()),
    Cmd: z.array(z.string()).nullable(),
  }),
  State: z.object({ Running: z.boolean() }),
  HostConfig: z.object({
    NetworkMode: z.string(),
    Privileged: z.literal(false),
    PidMode: z.literal(''),
    PortBindings: z.record(z.string(), z.unknown()).nullable(),
    ReadonlyRootfs: z.boolean(),
    CapAdd: z.array(z.string()).nullable(),
    CapDrop: z.array(z.string()).nullable(),
    SecurityOpt: z.array(z.string()).nullable(),
    Devices: z
      .array(
        z.object({
          PathOnHost: z.string(),
          PathInContainer: z.string(),
          CgroupPermissions: z.string(),
        }),
      )
      .nullable(),
  }),
  NetworkSettings: z.object({
    Networks: z.record(
      z.string(),
      z.object({ Aliases: z.array(z.string()).nullable() }),
    ),
  }),
  Mounts: z.array(
    z.object({
      Type: z.string(),
      Name: z.string().optional(),
      Source: z.string(),
      Destination: z.string(),
      RW: z.boolean(),
    }),
  ),
});
type Container = z.infer<typeof containerSchema>;

export const INFERENCE_NATIVE_KEY_ENV = providerKeyEnvNameSchema.parse(
  `${SECRETS_ENV_PREFIX}LOCAL_INFERENCE`,
);
export function inferenceEnvironment(
  spec: DeploymentSpec,
  serviceEnvironmentName: string,
  environment = process.env,
): Record<string, string> {
  if (!spec.inference)
    throw preconditionError('Inference declaration is missing.');
  const network = resolveValue(spec.inference.overlayNetwork, environment);
  if (!/^[a-f0-9]{16}$/.test(network))
    throw preconditionError(
      'Inference requires an explicit 16-character ZeroTier network ID.',
    );
  const key = inferenceApiKey(environment[serviceEnvironmentName]);
  return {
    [spec.inference.overlayNetwork.env]: network,
    [serviceEnvironmentName]: key,
    [INFERENCE_NATIVE_KEY_ENV]: key,
    TALE_ALLOW_PRIVATE_PROVIDER_HOSTS: '1',
  };
}
function localFiles(directory: string) {
  return Object.fromEntries(
    fileNames.map((file) => [file, readRegular(join(directory, file))]),
  ) as Record<(typeof fileNames)[number], Buffer>;
}
function fileHashes(contents: Record<(typeof fileNames)[number], Buffer>) {
  return hashes.parse(
    Object.fromEntries(fileNames.map((file) => [file, sha256(contents[file])])),
  );
}
function receipt(file: string): Receipt | undefined {
  if (!existsSync(file)) return undefined;
  const parsed = receiptSchema.safeParse(
    JSON.parse(readRegular(file).toString('utf8')),
  );
  if (
    !parsed.success ||
    (parsed.data.phase === 'ready' && !parsed.data.identityVolumeSha256) ||
    parsed.data.stage !==
      valueHash({
        companion: parsed.data.companionSha256,
        inputSha256: parsed.data.inputSha256,
        files: parsed.data.files,
      })
  )
    throw preconditionError(
      'Inference router recovery receipt is invalid. Preserve it for review.',
    );
  return parsed.data;
}

/** Read-only counterpart to ownedDirectory: dry-run/replay cannot repair an
 * unsafe owner, mode or symlink merely by rewriting the same bytes. */
async function inspectPrivateState(
  root: string,
  paths: string[],
): Promise<void> {
  let owner;
  try {
    owner = await lstat(root);
  } catch (error) {
    // A fresh runtime dry-run has not materialized its state directory yet.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
  if (
    !owner.isDirectory() ||
    owner.isSymbolicLink() ||
    (owner.mode & 0o022) !== 0
  )
    throw preconditionError(
      'Inference state has an unsafe owner, mode or directory.',
    );
  for (const path of paths) {
    const child = relative(root, path);
    if (!child || child.startsWith('..') || child.startsWith(sep))
      throw preconditionError(
        'Inference private state escaped its deployment.',
      );
    let current = root;
    for (const part of relative(root, dirname(path))
      .split(sep)
      .filter(Boolean)) {
      current = join(current, part);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          break;
        throw error;
      }
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== owner.uid ||
        (info.mode & 0o022) !== 0
      )
        throw preconditionError(
          'Inference state has a symlink, foreign owner or writable ancestor.',
        );
    }
    let file;
    try {
      file = await lstat(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        continue;
      throw error;
    }
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.uid !== owner.uid ||
      (file.mode & 0o077) !== 0
    )
      throw preconditionError(
        'Inference private file type, owner or mode differs.',
      );
  }
}

async function identityVolume(
  project: string,
  previous: Receipt | undefined,
  dependencies: RuntimeDependencies,
): Promise<string | undefined> {
  const listed = await runtimeCommand(
    ['volume', 'ls', '--format', '{{.Name}}'],
    dependencies,
  );
  const names = listed.stdout
    .split('\n')
    .filter((name) => name.startsWith(`${project}_`));
  const expected = `${project}_inference-overlay-identity`;
  if (names.length > 1 || names.some((name) => name !== expected))
    throw preconditionError(
      'Inference project contains an unrecognized volume.',
    );
  if (!previous && names.length)
    throw preconditionError(
      'Unreceipted inference volume already exists. No identity was adopted.',
    );
  if (!names.length) {
    if (previous?.phase === 'ready')
      throw preconditionError('Recorded inference identity volume is missing.');
    return undefined;
  }
  const inspected = await runtimeCommand(
    ['volume', 'inspect', expected],
    dependencies,
  );
  const volumes = z
    .array(
      z.object({
        Name: z.literal(expected),
        Driver: z.literal('local'),
        Scope: z.literal('local'),
        CreatedAt: z.string().min(1),
        Labels: z.record(z.string(), z.string()),
        Options: z.record(z.string(), z.string()).nullable(),
      }),
    )
    .length(1)
    .safeParse(JSON.parse(inspected.stdout));
  const volume = volumes.success ? volumes.data[0] : undefined;
  if (
    !volume ||
    Object.keys(volume.Options ?? {}).length !== 0 ||
    volume.Labels['com.docker.compose.project'] !== project ||
    volume.Labels['com.docker.compose.volume'] !== 'inference-overlay-identity'
  )
    throw preconditionError(
      'Inference identity volume policy or ownership differs.',
    );
  const identity = valueHash(volume);
  if (
    previous?.identityVolumeSha256 &&
    previous.identityVolumeSha256 !== identity
  )
    throw preconditionError('Recorded inference identity volume was replaced.');
  return identity;
}
function currentHashes(directory: string) {
  return nullableHashes.parse(
    Object.fromEntries(
      fileNames.map((file) => [
        file,
        existsSync(join(directory, file))
          ? sha256(readRegular(join(directory, file)))
          : null,
      ]),
    ),
  );
}
async function containers(
  project: string,
  dependencies: RuntimeDependencies,
): Promise<Container[]> {
  const result = await runtimeCommand(
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.ID}}',
    ],
    dependencies,
  );
  const ids = result.stdout
    .split('\n')
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    ids.length > 2 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id))
  )
    throw preconditionError(
      'Inference router container inventory is not the declared pair.',
    );
  if (!ids.length) return [];
  const inspected = await runtimeCommand(
    ['container', 'inspect', ...ids],
    dependencies,
  );
  const parsed = z
    .array(containerSchema)
    .max(2)
    .safeParse(JSON.parse(inspected.stdout));
  if (!parsed.success || parsed.data.length !== ids.length)
    throw preconditionError(
      'Inference router container readback is incomplete.',
    );
  return parsed.data;
}
function assertCustody(
  actual: Container[],
  spec: DeploymentSpec,
  directory: string,
  environment: Record<string, string>,
  serviceKeyEnv: string,
  policies: (string | null)[],
): void {
  const inference = spec.inference;
  if (!inference)
    throw preconditionError('Inference deployment configuration is required.');
  const project = inferenceProject(spec);
  const network = inferenceTopology(spec).backendNetwork;
  const seen = new Set<string>();
  const overlay = actual.find(
    (container) =>
      container.Config.Labels['com.docker.compose.service'] ===
      'inference-overlay',
  );
  for (const container of actual) {
    const labels = container.Config.Labels;
    const service = labels['com.docker.compose.service'];
    const image = INFERENCE_IMAGES.find((entry) => entry.service === service);
    if (
      !image ||
      seen.has(service) ||
      labels['com.docker.compose.project'] !== project ||
      labels['com.docker.compose.project.working_dir'] !== directory ||
      labels['com.docker.compose.container-number'] !== '1' ||
      labels['com.docker.compose.oneoff']?.toLowerCase() !== 'false' ||
      container.Config.Image !== image.reference ||
      Object.keys(container.HostConfig.PortBindings ?? {}).length !== 0
    )
      throw preconditionError(
        'Inference router container identity, image or private port policy differs.',
      );
    seen.add(service);
    const env = Object.fromEntries(
      container.Config.Env.map((entry) => {
        const index = entry.indexOf('=');
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
    );
    if (
      Object.keys(env).length !== container.Config.Env.length ||
      container.Config.Env.some((entry) => entry.indexOf('=') < 1)
    )
      throw preconditionError('Inference container environment is ambiguous.');
    if (service === 'inference-overlay') {
      if (
        container.HostConfig.NetworkMode !== network ||
        valueHash(Object.keys(container.NetworkSettings.Networks)) !==
          valueHash([network]) ||
        !container.NetworkSettings.Networks[network]?.Aliases?.includes(
          'inference-overlay.local',
        ) ||
        // Docker inspect adds one CAP_ prefix to the requested capability.
        // Preserve the array so duplicates and additional capabilities fail.
        valueHash(
          container.HostConfig.CapAdd?.map((capability) =>
            capability.replace(/^CAP_/u, ''),
          ) ?? null,
        ) !== valueHash(['NET_ADMIN']) ||
        valueHash(container.HostConfig.Devices) !==
          valueHash([
            {
              PathOnHost: '/dev/net/tun',
              PathInContainer: '/dev/net/tun',
              CgroupPermissions: 'rwm',
            },
          ]) ||
        env.ZT_NETWORKS !== environment[inference.overlayNetwork.env] ||
        env.ZT_OVERRIDE_LOCAL_CONF !== 'true' ||
        env.ZT_ALLOW_MANAGEMENT_FROM !== '' ||
        env.ZT_PORT_MAPPING_ENABLED !== 'false'
      )
        throw preconditionError(
          'Inference namespace network, capabilities or overlay policy differs.',
        );
      if (
        container.Mounts.length !== 1 ||
        !container.Mounts.some(
          (mount) =>
            mount.Type === 'volume' &&
            mount.Name === `${project}_inference-overlay-identity` &&
            mount.Destination === '/var/lib/zerotier-one' &&
            mount.RW,
        )
      )
        throw preconditionError('Inference namespace identity volume differs.');
    } else {
      if (
        !overlay ||
        container.HostConfig.NetworkMode !== `container:${overlay.Id}` ||
        Object.keys(container.NetworkSettings.Networks).length !== 0 ||
        !container.HostConfig.ReadonlyRootfs ||
        (container.HostConfig.CapAdd?.length ?? 0) !== 0 ||
        (container.HostConfig.Devices?.length ?? 0) !== 0 ||
        valueHash(container.HostConfig.CapDrop) !== valueHash(['ALL']) ||
        !container.HostConfig.SecurityOpt?.some((option) =>
          ['no-new-privileges:true', 'no-new-privileges'].includes(option),
        ) ||
        env[serviceKeyEnv] !== environment[serviceKeyEnv] ||
        !sha.safeParse(labels['dev.tale.inference.policy-sha256']).success ||
        !policies.includes(labels['dev.tale.inference.policy-sha256'])
      )
        throw preconditionError(
          'Inference proxy isolation or authentication differs.',
        );
      const binds = container.Mounts.filter((mount) => mount.Type !== 'tmpfs');
      if (
        binds.length !== 1 ||
        !binds.some(
          (mount) =>
            mount.Type === 'bind' &&
            mount.Source === join(directory, 'Caddyfile') &&
            mount.Destination === '/etc/caddy/Caddyfile' &&
            !mount.RW,
        ) ||
        container.Mounts.some(
          (mount) =>
            mount.Type === 'tmpfs' &&
            !['/data', '/config'].includes(mount.Destination),
        )
      )
        throw preconditionError('Inference proxy policy mount differs.');
      if (
        valueHash(container.Config.Cmd) !==
        valueHash([
          'caddy',
          'run',
          '--config',
          '/etc/caddy/Caddyfile',
          '--adapter',
          'caddyfile',
        ])
      )
        throw preconditionError('Inference proxy command differs.');
    }
  }
}

/** Same managed-deployment lock as runtime/config provisioning. This isolated
 * companion never changes the legacy runtime topology or opens a host port. */
export async function applyManagedInference(
  bundleDirectory: string,
  spec: DeploymentSpec,
  dryRun = false,
  dependencies: RuntimeDependencies = {},
  environment = process.env,
) {
  const inference = spec.inference;
  if (!inference)
    throw preconditionError('Inference deployment configuration is required.');
  const verified = await verifyManagedInference(bundleDirectory, spec);
  const values = inferenceEnvironment(
    spec,
    verified.bundle.spec.serviceKey.env,
    environment,
  );
  const project = inferenceProject(spec);
  const directory = join(spec.stateDirectory, 'inference');
  const state = join(spec.stateDirectory, '.tale');
  const receiptPath = join(state, 'inference-router.json');
  await inspectPrivateState(spec.stateDirectory, [
    receiptPath,
    ...fileNames.map((file) => join(directory, file)),
  ]);
  const inputSha256 = valueHash(values);
  const planned = {
    'compose.yml': Buffer.from(
      await readFile(join(bundleDirectory, 'router/compose.yml')),
    ),
    Caddyfile: Buffer.from(verified.caddyfile),
    '.env': Buffer.from(
      Object.entries({
        [inference.overlayNetwork.env]: values[inference.overlayNetwork.env],
        [verified.bundle.spec.serviceKey.env]:
          values[verified.bundle.spec.serviceKey.env],
      })
        .map(([key, value]) => `${key}='${value}'\n`)
        .join(''),
    ),
  };
  const wantedHashes = fileHashes(planned);
  const stage = valueHash({
    companion: verified.identity,
    inputSha256,
    files: wantedHashes,
  });
  const staging = join(state, `inference-router-${stage}`);
  await inspectPrivateState(
    spec.stateDirectory,
    fileNames.map((file) => join(staging, file)),
  );
  let previous = receipt(receiptPath);
  if (
    previous &&
    (previous.name !== spec.name || previous.composeProject !== project)
  )
    throw preconditionError(
      'Inference router state belongs to another deployment.',
    );
  if (
    previous?.phase === 'pending' &&
    (previous.companionSha256 !== verified.identity ||
      previous.inputSha256 !== inputSha256)
  )
    throw preconditionError(
      'A different inference companion is pending. Resume its exact bundle and keys first.',
    );
  const unchanged =
    previous?.phase === 'ready' &&
    previous.companionSha256 === verified.identity &&
    previous.inputSha256 === inputSha256;
  const retainedRollback =
    previous?.phase === 'ready' && previous.previousStage === stage;
  if (
    retainedRollback &&
    valueHash(fileHashes(localFiles(staging))) !== valueHash(wantedHashes)
  )
    throw preconditionError(
      'Retained inference rollback bytes differ from their recorded stage.',
    );
  const installed = currentHashes(directory);
  if (previous) {
    for (const file of fileNames)
      if (
        previous.phase === 'ready'
          ? installed[file] !== previous.files[file]
          : installed[file] !== previous.files[file] &&
            installed[file] !== previous.before[file]
      )
        throw preconditionError(
          'Inference router files drifted or contain an unrelated partial write.',
        );
  } else if (Object.values(installed).some((hash) => hash !== null))
    throw preconditionError(
      'Unreceipted inference files already exist. No existing state was replaced.',
    );
  const actual = await containers(project, dependencies);
  await identityVolume(project, previous, dependencies);
  if (!previous && actual.length)
    throw preconditionError(
      'Unreceipted inference containers already exist. No existing service was adopted.',
    );
  // Existing pair must match the current declared network/authentication before
  // any write. Key/network changes therefore require explicit drain/recovery.
  const acceptedPolicies = previous
    ? [
        previous.files.Caddyfile,
        ...(previous.phase === 'pending' ? [previous.before.Caddyfile] : []),
      ]
    : [];
  if (actual.length)
    assertCustody(
      actual,
      spec,
      directory,
      values,
      verified.bundle.spec.serviceKey.env,
      acceptedPolicies,
    );
  if (!unchanged && !retainedRollback && previous?.phase !== 'pending')
    admittedProofs(
      verified.bundle.spec,
      verified.proofs,
      Date.now(),
      verified.bundle.bundleSha256,
    );
  const base = {
    configured: !dryRun,
    modelReadiness: verified.proofs.length
      ? 'requires-live-route-health'
      : 'no-admitted-nodes',
    admittedNodes: verified.proofs.map((proof) => proof.node),
    companionSha256: verified.identity,
    composeProject: project,
    unchanged,
    hostPorts: [] as number[],
  };
  if (dryRun) return { ...base, dryRun: true };
  const inspectedNetwork = await runtimeCommand(
    ['network', 'inspect', inferenceTopology(spec).backendNetwork],
    dependencies,
  );
  const network = z
    .array(
      z.object({
        Name: z.string(),
        Driver: z.literal('bridge'),
        Internal: z.literal(false),
        Labels: z.record(z.string(), z.string()),
      }),
    )
    .length(1)
    .safeParse(JSON.parse(inspectedNetwork.stdout));
  if (
    !network.success ||
    network.data[0]?.Name !== inferenceTopology(spec).backendNetwork ||
    network.data[0]?.Labels['com.docker.compose.project'] !==
      spec.composeProject ||
    network.data[0]?.Labels['com.docker.compose.network'] !== 'internal'
  )
    throw preconditionError(
      'The inferred Tale backend bridge is not the verified runtime network.',
    );
  if (unchanged) {
    if (
      actual.length !== 2 ||
      actual.some((container) => !container.State.Running)
    )
      throw preconditionError(
        'Recorded inference router is not running. Inspect it before changing state.',
      );
    await verifyConfigured(actual, directory, wantedHashes, dependencies);
    return { ...base, dryRun: false };
  }
  for (const image of INFERENCE_IMAGES) {
    await runtimeCommand(
      ['pull', '--platform', spec.runtime.platform, image.reference],
      dependencies,
      { timeout: 1800 },
    );
    const inspected = await inspectRuntimeImage(
      image.reference,
      image.repository,
      spec.runtime.platform,
      null,
      dependencies,
    );
    if (inspected.digest !== image.reference.split('@')[1])
      throw preconditionError(
        'Inference image digest differs before activation.',
      );
  }
  await ownedDirectory(state, spec.stateDirectory);
  await ownedDirectory(directory, spec.stateDirectory);
  if (!previous || previous.phase !== 'pending') {
    await ownedDirectory(staging, spec.stateDirectory);
    for (const file of fileNames) {
      const path = join(staging, file);
      if (existsSync(path) && sha256(readRegular(path)) !== wantedHashes[file])
        throw preconditionError(
          'Retained inference stage differs from its content address.',
        );
      atomicRuntimeFile(path, planned[file]);
    }
    previous = receiptSchema.parse({
      schemaVersion: 1,
      kind: 'tale-inference-router',
      phase: 'pending',
      name: spec.name,
      composeProject: project,
      companionSha256: verified.identity,
      inputSha256,
      stage,
      ...(previous ? { previousStage: previous.stage } : {}),
      ...(previous?.identityVolumeSha256
        ? { identityVolumeSha256: previous.identityVolumeSha256 }
        : {}),
      files: wantedHashes,
      before: installed,
    });
    atomicRuntimeFile(receiptPath, JSON.stringify(previous, null, 2) + '\n');
  }
  if (
    previous.stage !== stage ||
    valueHash(fileHashes(localFiles(staging))) !== valueHash(previous.files)
  )
    throw preconditionError(
      'Pending inference stage differs from its exact recorded files.',
    );
  for (const file of fileNames)
    atomicRuntimeFile(join(directory, file), readRegular(join(staging, file)));
  const args = [
    'compose',
    '-p',
    project,
    '--project-directory',
    directory,
    '--env-file',
    join(directory, '.env'),
    '-f',
    join(directory, 'compose.yml'),
  ];
  await runtimeCommand([...args, 'config', '--quiet'], dependencies, {
    cwd: directory,
  });
  // An accepted response loss is reconciled from its exact container pair. A
  // stopped/partial pair receives one idempotent Compose convergence, not a retry.
  const resumed = await containers(project, dependencies);
  if (resumed.length)
    assertCustody(
      resumed,
      spec,
      directory,
      values,
      verified.bundle.spec.serviceKey.env,
      [wantedHashes.Caddyfile, ...acceptedPolicies],
    );
  const currentPolicy = resumed.find(
    (container) =>
      container.Config.Labels['com.docker.compose.service'] ===
      'inference-router',
  )?.Config.Labels['dev.tale.inference.policy-sha256'];
  if (
    resumed.length !== 2 ||
    resumed.some((container) => !container.State.Running) ||
    currentPolicy !== wantedHashes.Caddyfile
  )
    await runtimeCommand(
      [...args, 'up', '-d', '--no-build', '--pull', 'never'],
      dependencies,
      { cwd: directory, timeout: 300 },
    );
  let ready: Container[] = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    ready = await containers(project, dependencies);
    assertCustody(
      ready,
      spec,
      directory,
      values,
      verified.bundle.spec.serviceKey.env,
      [wantedHashes.Caddyfile],
    );
    if (
      ready.length === 2 &&
      ready.every((container) => container.State.Running)
    )
      break;
    if (attempt < 19) await runtimeSleep(dependencies, 1000);
  }
  if (ready.length !== 2 || ready.some((container) => !container.State.Running))
    throw externalDepError(
      'Inference router did not converge. Pending state and its prior stage are retained.',
    );
  await verifyConfigured(ready, directory, wantedHashes, dependencies);
  const identityVolumeSha256 = await identityVolume(
    project,
    previous,
    dependencies,
  );
  if (!identityVolumeSha256)
    throw preconditionError('Activated inference identity volume is absent.');
  atomicRuntimeFile(
    receiptPath,
    JSON.stringify(
      { ...previous, phase: 'ready', identityVolumeSha256 },
      null,
      2,
    ) + '\n',
  );
  return { ...base, unchanged: false, dryRun: false };
}

async function verifyConfigured(
  ready: Container[],
  directory: string,
  wantedHashes: z.infer<typeof hashes>,
  dependencies: RuntimeDependencies,
): Promise<void> {
  const proxy = ready.find(
    (container) =>
      container.Config.Labels['com.docker.compose.service'] ===
      'inference-router',
  );
  if (!proxy) throw preconditionError('Inference proxy container is absent.');
  await runtimeCommand(
    [
      'exec',
      proxy.Id,
      'caddy',
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ],
    dependencies,
  );
  if (valueHash(currentHashes(directory)) !== valueHash(wantedHashes))
    throw preconditionError(
      'Inference router files changed before its ready receipt.',
    );
  await inspectPrivateState(
    dirname(directory),
    fileNames.map((file) => join(directory, file)),
  );
}

/** Observe the declared namespace for fleet enrollment without adopting,
 * joining, authorizing or repairing state. The ready companion is the owner;
 * a controller may still deny that node until the fleet authorizes it. */
export async function observeManagedInference(
  bundleDirectory: string,
  spec: DeploymentSpec,
  dependencies: RuntimeDependencies = {},
) {
  const inference = spec.inference;
  if (!inference)
    throw preconditionError('Deployment has no inference declaration.');
  const verified = await verifyManagedInference(bundleDirectory, spec);
  const directory = join(spec.stateDirectory, 'inference');
  const receiptPath = join(
    spec.stateDirectory,
    '.tale',
    'inference-router.json',
  );
  const inspect = async () => {
    await inspectPrivateState(spec.stateDirectory, [
      receiptPath,
      ...fileNames.map((file) => join(directory, file)),
    ]);
    const current = receipt(receiptPath);
    if (
      !current ||
      current.phase !== 'ready' ||
      current.name !== spec.name ||
      current.composeProject !== inferenceProject(spec) ||
      current.companionSha256 !== verified.identity
    )
      throw preconditionError(
        'Inference namespace observation requires the exact ready companion.',
      );
    const files = localFiles(directory);
    const values = inferenceEnvironment(
      spec,
      verified.bundle.spec.serviceKey.env,
      parseRuntimeEnvironment(files['.env'].toString('utf8'), 'compose'),
    );
    if (
      valueHash(fileHashes(files)) !== valueHash(current.files) ||
      valueHash(values) !== current.inputSha256 ||
      !files['compose.yml'].equals(
        await readFile(join(bundleDirectory, 'router/compose.yml')),
      ) ||
      files.Caddyfile.toString('utf8') !== verified.caddyfile
    )
      throw preconditionError(
        'Inference namespace files differ from their ready companion.',
      );
    await identityVolume(inferenceProject(spec), current, dependencies);
    const actual = await containers(inferenceProject(spec), dependencies);
    assertCustody(
      actual,
      spec,
      directory,
      values,
      verified.bundle.spec.serviceKey.env,
      [current.files.Caddyfile],
    );
    if (
      actual.length !== 2 ||
      actual.some((container) => !container.State.Running)
    )
      throw preconditionError(
        'Inference namespace observation requires its running container pair.',
      );
    const overlay = actual.find(
      (container) =>
        container.Config.Labels['com.docker.compose.service'] ===
        'inference-overlay',
    );
    if (!overlay)
      throw preconditionError('Inference namespace container is absent.');
    return {
      current,
      actual,
      overlay,
      networkId: values[inference.overlayNetwork.env],
    };
  };
  const before = await inspect();
  const read = async (command: 'info' | 'listnetworks'): Promise<unknown> => {
    const result = await runtimeCommand(
      ['exec', before.overlay.Id, 'zerotier-cli', '-j', command],
      dependencies,
      { timeout: 15 },
    );
    if (Buffer.byteLength(result.stdout) > 1_048_576)
      throw preconditionError(
        'Inference namespace response exceeds its bounded size.',
      );
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw preconditionError('Inference namespace returned malformed status.');
    }
  };
  const info = z
    .object({
      address: z.string().regex(/^[a-f0-9]{10}$/),
      online: z.boolean(),
      version: z.literal('1.16.2'),
    })
    .safeParse(await read('info'));
  const networks = z
    .array(
      z.object({
        id: z.string().regex(/^[a-f0-9]{16}$/),
        nwid: z.string().regex(/^[a-f0-9]{16}$/),
        status: z.enum([
          'REQUESTING_CONFIGURATION',
          'OK',
          'ACCESS_DENIED',
          'NOT_FOUND',
          'PORT_ERROR',
          'CLIENT_TOO_OLD',
          'AUTHENTICATION_REQUIRED',
        ]),
        type: z.literal('PRIVATE'),
        allowManaged: z.literal(true),
        allowGlobal: z.literal(false),
        allowDefault: z.literal(false),
        allowDNS: z.literal(false),
        assignedAddresses: z.array(z.union([z.cidrv4(), z.cidrv6()])).max(16),
      }),
    )
    .length(1)
    .safeParse(await read('listnetworks'));
  const network = networks.success ? networks.data[0] : undefined;
  if (
    !info.success ||
    !network ||
    network.id !== before.networkId ||
    network.nwid !== network.id ||
    new Set(network.assignedAddresses).size !==
      network.assignedAddresses.length ||
    (network.status !== 'OK' && network.assignedAddresses.length !== 0)
  )
    throw preconditionError(
      'Inference namespace identity or private network policy differs.',
    );
  const after = await inspect();
  if (valueHash(before) !== valueHash(after))
    throw preconditionError(
      'Inference namespace changed during observation; observe again.',
    );
  return {
    schemaVersion: 1 as const,
    kind: 'tale-inference-overlay' as const,
    deployment: spec.name,
    companionSha256: verified.identity,
    inferenceBundleSha256: verified.bundle.bundleSha256,
    source: verified.metadata.source,
    observedAt: new Date().toISOString(),
    nodeId: info.data.address,
    networkId: network.id,
    status: network.status,
    networkType: network.type,
    online: info.data.online,
    assignedAddresses: network.assignedAddresses,
    networkReady:
      info.data.online &&
      network.status === 'OK' &&
      network.assignedAddresses.length > 0,
  };
}
