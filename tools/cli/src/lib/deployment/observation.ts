import { randomUUID } from 'node:crypto';
import { lstatSync, statfsSync } from 'node:fs';
import { arch, freemem, totalmem } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import { gitSha, sha, slug } from '../config/releases/model';
import type { exec } from '../docker/exec';
import type { IncusRuntime } from '../runtime/incus/incus-runtime';
import { LOCAL_HTTP_ENVIRONMENT } from './acceptance-health';
import { migrationReadScript } from './acceptance-migrations';
import { backendDataOwner } from './backend-cli';
import { parseDeclarationText } from './declaration-text';
import { resolveDeploymentSpec, resolveValue } from './model';
import {
  ObservationCleanupError,
  nativeObservationFailure,
  observationPhases,
  type SetObservationPhase,
} from './observation-errors';
import { observationFile } from './observation-files';
import {
  nativeObservationResultSchema,
  observationEnvironmentSchema,
} from './observation-model';
import {
  observedDatabaseFacts,
  OBSERVATION_APP_SQL,
  OBSERVATION_KNOWLEDGE_SQL,
} from './observation-sql';
import { readProvisionStateProof } from './provision-state';
import type { RuntimeBudget, RuntimeInstance } from './runtime-access';
import { startedAtSchema } from './runtime-apply';
import { deploymentAccess } from './runtime-incus-apply';

export interface ObserveDeploymentOptions {
  spec: string;
  cliRef: string;
  deploymentRef: string;
  machineIdSha256: string;
}
interface ObservationDependencies {
  exec?: typeof exec;
  build?: () => { revision: string; binary: string };
  machineId?: () => Buffer;
  now?: () => number;
  environment?: NodeJS.ProcessEnv;
  /** The stack's Incus runtime (tests). */
  incusRuntime?: IncusRuntime;
}
/** One observation call's own bounds: a longer wait, or a cleanup step's
 * small allowance outside the output budget. */
interface ObservationCall {
  duration?: number;
  cleanup?: boolean;
}
const safeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const readySchema = z.object({
  schemaVersion: z.literal(1),
  phase: z.literal('ready'),
  name: slug,
  revision: gitSha,
  cliRevision: gitSha,
  deploymentRef: gitSha.optional(),
  bundleSha256: sha,
  native: z
    .object({ organizationId: safeId, organizationSlug: slug, userId: safeId })
    .optional(),
});
const mountSchema = z.object({
  Type: z.enum(['bind', 'volume', 'tmpfs']),
  Source: z.string().max(4096),
  Destination: z.string().max(4096),
});
const containerSchema = z.strictObject({
  id: sha,
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  project: slug,
  service: slug,
  running: z.boolean(),
  startedAt: startedAtSchema,
  restartCount: z.number().int().nonnegative(),
  mounts: z.array(mountSchema).max(64),
});
/** The observed record of an instance, from its metadata-only readback. */
const observedContainer = (instance: RuntimeInstance) => ({
  id: instance.id,
  image: instance.image,
  project: instance.labels?.['com.docker.compose.project'],
  service: instance.labels?.['com.docker.compose.service'],
  running: instance.running,
  startedAt: instance.startedAt,
  restartCount: instance.restartCount,
  mounts: instance.mounts?.map((mount) => ({
    Type: mount.type,
    Source: mount.source,
    Destination: mount.target,
  })),
});
const absentLabel = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? null : value), schema.nullable());
const imageSchema = z.strictObject({
  id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  revision: absentLabel(gitSha),
  version: absentLabel(safeId),
  architecture: z.enum(['amd64', 'arm64']),
  os: z.literal('linux'),
});
const localDockerEnvironment = () => ({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  DOCKER_HOST: 'unix:///var/run/docker.sock',
});

/** Metadata only. No deployment lock, preparation, pull, restart, migration or
 * application-state write. Temporary tooling and auth sessions are explicit. */
export async function observeDeployment(
  options: ObserveDeploymentOptions,
  privateInput: unknown,
  dependencies: ObservationDependencies = {},
) {
  return observationPhases('host', (phase) =>
    readDeployment(options, privateInput, dependencies, phase),
  );
}

async function readDeployment(
  options: ObserveDeploymentOptions,
  privateInput: unknown,
  dependencies: ObservationDependencies,
  phase: SetObservationPhase,
) {
  const now = dependencies.now ?? performance.now.bind(performance);
  const deadline = now() + 60_000;
  gitSha.parse(options.cliRef);
  gitSha.parse(options.deploymentRef);
  sha.parse(options.machineIdSha256);
  const environment = dependencies.environment ?? process.env;
  if (
    (environment.DOCKER_HOST &&
      environment.DOCKER_HOST !== 'unix:///var/run/docker.sock') ||
    environment.DOCKER_CONTEXT ||
    environment.DOCKER_TLS_VERIFY ||
    environment.DOCKER_CERT_PATH
  )
    throw preconditionError(
      'Deployment observation requires the admitted host local Docker socket.',
    );
  const build =
    dependencies.build?.() ?? (await import('./build')).deploymentBuild();
  if (build.revision !== options.cliRef)
    throw preconditionError(
      'Observation CLI differs from its expected source.',
    );
  const cliSha256 = observationFile(build.binary, 256 * 1024 * 1024).sha256;
  const machineId = (
    dependencies.machineId?.() ?? observationFile('/etc/machine-id', 128).bytes
  )
    .toString('utf8')
    .trim();
  if (
    !/^[a-f0-9]{32}$/.test(machineId) ||
    sha256(machineId) !== options.machineIdSha256
  )
    throw preconditionError(
      'Observation reached a different machine identity.',
    );
  const specFile = observationFile(options.spec, 1_048_576);
  const selectedEnvironment =
    observationEnvironmentSchema.parse(privateInput).environment;
  const spec = resolveDeploymentSpec(
    parseDeclarationText(specFile.bytes.toString('utf8'), options.spec),
    selectedEnvironment,
  );
  if (!spec.identity)
    throw preconditionError(
      'Observation requires a declared existing native identity.',
    );
  let outputBytes = 0;
  // Every call is bounded by the observation's deadline and output budget; a
  // cleanup step has its own small allowance and does not spend the budget.
  const budget: RuntimeBudget<ObservationCall> = {
    bounds: (call) => {
      const remaining = deadline - now() - (call?.cleanup ? 0 : 5000);
      if (remaining <= 0)
        throw preconditionError(
          'Deployment observation exceeded its deadline.',
        );
      return {
        timeout: Math.min(call?.duration ?? 10, remaining / 1000),
        maxOutputBytes: call?.cleanup ? 65536 : 1_048_576,
      };
    },
    failed: () =>
      externalDepError('Bounded deployment observation command failed.'),
    settled: (result, call) => {
      const size =
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
      if (!call?.cleanup) outputBytes += size;
      if (
        (call?.cleanup ? size > 65536 : outputBytes > 4_194_304) ||
        now() >= deadline
      )
        throw preconditionError(
          'Deployment observation exceeded its output or time budget.',
        );
    },
    refused: () =>
      externalDepError('A deployment observation command was refused.'),
  };
  const runtime = await deploymentAccess(
    spec,
    budget,
    { exec: dependencies.exec, environment: localDockerEnvironment },
    [],
    dependencies.incusRuntime,
  );
  const pending = join(spec.stateDirectory, '.tale', 'deployment-pending.json');
  const readyFile = join(spec.stateDirectory, '.tale', 'deployment-ready.json');
  const retained = () => {
    try {
      lstatSync(pending);
      throw preconditionError('An unfinished deployment prevents observation.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const proof = readProvisionStateProof(readyFile, readySchema, 1_048_576);
    if (proof && observationFile(readyFile, 1_048_576).sha256 !== proof.sha256)
      throw preconditionError(
        'Retained deployment custody changed while being read.',
      );
    if (
      proof &&
      (proof.value.name !== spec.name ||
        (proof.value.native &&
          proof.value.native.organizationSlug !== spec.identity?.slug))
    )
      throw preconditionError(
        'Retained deployment identity differs from the selected target.',
      );
    return proof;
  };
  phase('retained');
  const before = retained();
  phase('containers');
  const ids = async () =>
    z
      .array(sha)
      .min(1)
      .max(64)
      .refine((value) => new Set(value).size === value.length)
      .parse(await runtime.list({ stack: spec.composeProject }))
      .sort();
  const selectedIds = await ids();
  const containers = async () =>
    z
      .array(containerSchema)
      .min(1)
      .max(64)
      .parse(
        (await runtime.inspect(selectedIds, { metadataOnly: true })).map(
          observedContainer,
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
  const captured = await containers();
  if (
    stableJson(captured.map((container) => container.id)) !==
      stableJson(selectedIds) ||
    captured.some((container) => container.project !== spec.composeProject) ||
    new Set(captured.map((container) => container.service)).size !==
      captured.length
  )
    throw preconditionError(
      'Observed containers do not identify one exact Compose deployment.',
    );
  const service = (name: string) => {
    const matches = captured.filter(
      (container) => container.service === name && container.running,
    );
    if (matches.length !== 1)
      throw preconditionError(
        'Observation requires one running database and backend per deployment.',
      );
    return matches[0];
  };
  phase('application');
  const app = await runtime.exec(service('db').id, ['sh', '-s'], {
    stdin: migrationReadScript('db', OBSERVATION_APP_SQL),
  });
  phase('knowledge');
  const knowledge = await runtime.exec(
    service('knowledge-db').id,
    ['sh', '-s'],
    {
      stdin: migrationReadScript('knowledge-db', OBSERVATION_KNOWLEDGE_SQL),
    },
  );
  phase('database');
  const database = observedDatabaseFacts(app.stdout, knowledge.stdout);
  phase('images');
  const images = [];
  for (const id of [
    ...new Set(captured.map((container) => container.image)),
  ].sort()) {
    const [read] = await runtime.inspectImage([id], { metadataOnly: true });
    const image = imageSchema.parse({
      id: read?.id,
      revision: read?.labels?.['org.opencontainers.image.revision'] ?? null,
      version: read?.labels?.['org.opencontainers.image.version'] ?? null,
      architecture: read?.architecture,
      os: read?.os,
    });
    if (image.id !== id)
      throw preconditionError('Observed image identity changed.');
    images.push(image);
  }
  phase('filesystems');
  const disk = (directory: string) => {
    const value = statfsSync(directory);
    return {
      availableBytes: value.bavail * value.bsize,
      totalBytes: value.blocks * value.bsize,
    };
  };
  const filesystems = [{ role: 'deployment', ...disk(spec.stateDirectory) }];
  for (const name of ['db', 'knowledge-db', 'backend-api']) {
    const selected = service(name);
    for (const mount of selected.mounts.filter(
      (entry) => entry.Type !== 'tmpfs',
    )) {
      if (!mount.Source.startsWith('/'))
        throw preconditionError('Observed mount source is not absolute.');
      filesystems.push({
        role: `${name}:${mount.Destination}`,
        ...disk(mount.Source),
      });
    }
  }
  let native: z.infer<typeof nativeObservationResultSchema> = {
    status: 'unavailable',
    reason: 'retained_identity_missing',
  };
  if (before?.value.native) {
    phase('tooling');
    const backend = service('backend-api').id;
    const temporary = `/tmp/tale-observe-${randomUUID()}`;
    const binary = `${temporary}/tale`;
    const owner = await backendDataOwner(runtime, backend);
    const group = owner.split(':')[1];
    const cleanTemporary = async () => {
      try {
        const type = (
          await runtime.exec(
            backend,
            ['stat', '-c', '%F:%u', '--', temporary],
            {
              tag: { duration: 2, cleanup: true },
            },
          )
        ).stdout.trim();
        if (type !== 'directory:0') throw Error('custody');
        await runtime.exec(backend, ['rm', '-rf', '--', temporary], {
          tag: { duration: 3, cleanup: true },
        });
      } catch {
        throw new ObservationCleanupError('tooling');
      }
    };
    await runtime.exec(backend, ['mkdir', '-m', '700', temporary]);
    try {
      await runtime.copyIn(backend, { file: build.binary }, binary);
      await runtime.exec(backend, ['chmod', '550', binary]);
      await runtime.exec(backend, ['chown', `0:${group}`, temporary, binary]);
      await runtime.exec(backend, ['chmod', '510', temporary]);
      const custody = (
        await runtime.exec(backend, [
          'stat',
          '-c',
          '%F:%u:%g:%a:%h',
          '--',
          temporary,
          binary,
        ])
      ).stdout
        .trim()
        .split('\n');
      if (
        !/^directory:0:[0-9]+:510:[0-9]+$/.test(custody[0] ?? '') ||
        custody[0].split(':')[2] !== group ||
        custody[1] !== `regular file:0:${group}:550:1`
      )
        throw preconditionError(
          'Native observation tooling has unsafe custody.',
        );
      const copied = (await runtime.exec(backend, ['sha256sum', binary])).stdout
        .trim()
        .split(/\s+/);
      if (
        copied.length !== 2 ||
        copied[0] !== cliSha256 ||
        copied[1] !== binary
      )
        throw preconditionError(
          'Copied observation CLI differs from the admitted executable.',
        );
      const budgetMs = Math.floor(Math.min(45_000, deadline - now() - 10_000));
      if (budgetMs < 6000)
        throw preconditionError(
          'Insufficient time remains for bounded native observation and cleanup.',
        );
      const input = {
        schemaVersion: 1,
        cliRevision: build.revision,
        cliSha256,
        budgetMs,
        target: {
          name: spec.name,
          origin: spec.origin,
          organizationId: before.value.native.organizationId,
          organizationSlug: before.value.native.organizationSlug,
          organizationName: spec.identity.name,
          userId: before.value.native.userId,
        },
        operator: {
          email: resolveValue(spec.identity.email, selectedEnvironment),
          password: spec.identity.password
            ? resolveValue(spec.identity.password, selectedEnvironment)
            : '',
        },
      };
      phase('native');
      const result = await runtime.exec(
        backend,
        [binary, 'deploy', 'observe-native', '--json'],
        {
          stdin: JSON.stringify(input),
          environment: LOCAL_HTTP_ENVIRONMENT,
          user: owner,
          allowFailure: true,
          tag: { duration: (budgetMs + 1000) / 1000 },
        },
      );
      const rawResponse: unknown = JSON.parse(result.stdout);
      const nativeFailure = nativeObservationFailure(rawResponse);
      if (nativeFailure) throw nativeFailure;
      const envelope = z
        .object({
          ok: z.boolean(),
          command: z.literal('deploy observe-native'),
          data: nativeObservationResultSchema,
        })
        .parse(rawResponse);
      native = envelope.data;
      if (
        envelope.ok !== (native.status === 'observed') ||
        result.exitCode !== (envelope.ok ? 0 : 3)
      )
        throw preconditionError(
          'Native observation status and exit code differ.',
        );
      if (
        native.status === 'observed' &&
        stableJson(native.identity) !== stableJson(input.target)
      )
        throw preconditionError(
          'Native observation returned a different identity.',
        );
    } finally {
      await cleanTemporary();
    }
  }
  phase('stability');
  const after = retained();
  if (
    before?.sha256 !== after?.sha256 ||
    observationFile(options.spec, 1_048_576).sha256 !== specFile.sha256 ||
    observationFile(build.binary, 256 * 1024 * 1024).sha256 !== cliSha256 ||
    stableJson(await ids()) !== stableJson(selectedIds) ||
    stableJson(await containers()) !== stableJson(captured)
  )
    throw preconditionError(
      'Deployment identity or retained state changed during observation.',
    );
  const backendRevision = images.find(
    (image) => image.id === service('backend-api').image,
  )?.revision;
  const result = {
    schemaVersion: 1,
    kind: 'tale-deployment-observation',
    complete: Boolean(
      before && native.status === 'observed' && backendRevision,
    ),
    observedAt: new Date().toISOString(),
    cliRevision: build.revision,
    cliSha256,
    deploymentRef: options.deploymentRef,
    specSha256: specFile.sha256,
    target: {
      name: spec.name,
      composeProject: spec.composeProject,
      origin: spec.origin,
      machineIdSha256: options.machineIdSha256,
    },
    host: {
      architecture: arch(),
      freeMemoryBytes: freemem(),
      totalMemoryBytes: totalmem(),
      filesystems,
    },
    retained: before
      ? { status: 'observed', receiptSha256: before.sha256, ...before.value }
      : { status: 'unavailable', reason: 'retained_state_missing' },
    containers: captured.map(({ mounts: _mounts, ...container }) => container),
    images,
    runtimeSource: backendRevision
      ? { status: 'observed', revision: backendRevision }
      : { status: 'unavailable', reason: 'runtime_source_missing' },
    database,
    native,
    claim:
      'Point-in-time read-only observations; not Ready acceptance, pack preservation across a deployment, or cutover authorization.',
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 1_048_576)
    throw preconditionError('Deployment observation exceeds the report limit.');
  return result;
}
