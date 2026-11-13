/**
 * The Docker runtime: today's `lib/docker` functions behind `StackRuntime`.
 *
 * A facade, not a rewrite. Each verb calls exactly the function the actions
 * called before, with the same arguments, so the argv Docker receives is the
 * same (`docker-runtime.test.ts` records a whole blue/green deploy to prove
 * it). Every call goes through a binding resolved at call time, never a
 * reference captured here, so a test that replaces one of those modules still
 * reaches its replacement through the runtime.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { pipeLines } from '@tale/shared/process';
import { z } from 'zod';

import { preconditionError } from '../../../utils/fail';
import * as logger from '../../../utils/logger';
import { BACKUP_HELPER_IMAGE } from '../../backup/constants';
import type { DeploymentColor } from '../../compose/types';
import { AUTOMATION_PROTOCOL_LABEL } from '../../deployment/automation-model';
import { containerExists } from '../../docker/container-exists';
import { detachColorFromNetworks } from '../../docker/detach-color';
import { docker } from '../../docker/docker';
import { dockerCompose } from '../../docker/docker-compose';
import { ensureDocker } from '../../docker/ensure-docker';
import { imagePresent } from '../../docker/ensure-image-present';
import {
  ensureNetwork,
  ensureSandboxNetwork,
} from '../../docker/ensure-network';
import { ensureVolumes, volumeExists } from '../../docker/ensure-volumes';
import { exec } from '../../docker/exec';
import { getContainerHealth } from '../../docker/get-container-health';
import { getContainerState } from '../../docker/get-container-state';
import { getContainerVersion } from '../../docker/get-container-version';
import { checkDaemon } from '../../docker/health-checks';
import { isContainerRunning } from '../../docker/is-container-running';
import { listContainers } from '../../docker/list-containers';
import {
  composeCreatedContainerFilters,
  listComposeContainers,
} from '../../docker/list-service-containers';
import { migrateConfigVolume } from '../../docker/migrate-config-volume';
import { pullImage } from '../../docker/pull-image';
import { removeContainer } from '../../docker/remove-container';
import { removeVolume } from '../../docker/remove-volume';
import { probeDockerEngine } from '../../docker/setup-checks';
import { stopContainer } from '../../docker/stop-container';
import { waitForHealthy } from '../../docker/wait-for-healthy';
import { waitForServiceHealthy } from '../../docker/wait-for-service-healthy';
import {
  listContainersUsingVolume,
  withVolumeContainersPaused,
} from '../../docker/with-volume-paused';
import { readImageFacts } from '../../oci/image-facts';
import { createRegistryClient, type RegistryClient } from '../../oci/registry';
import { getProjectId } from '../../project/project-context';
import {
  type ConvergeScope,
  type EnsuredImages,
  type InstanceInfo,
  type InstanceSummary,
  type StackRuntime,
  pickInstanceEnvironment,
} from '../types';

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const NUMBER_LABEL = 'com.docker.compose.container-number';
const ONEOFF_LABEL = 'com.docker.compose.oneoff';

/** The collaborators a caller may replace: the host-level ones its own
 *  tests inject (`tale deploy` passes its `ensureDocker`). */
export interface DockerRuntimeOverrides {
  ensureDocker?: typeof ensureDocker;
  /** The registry `inspectImage` reads; an anonymous client by default. */
  registry?: RegistryClient;
  /** The platform `inspectImage` reads facts for; the host's by default. */
  platform?: string;
}

/** The image platform of the host the CLI runs on, which a local Docker
 *  engine runs too. */
function hostPlatform(): string {
  const architecture =
    process.arch === 'x64'
      ? 'amd64'
      : process.arch === 'arm'
        ? 'arm/v7'
        : process.arch;
  return `linux/${architecture}`;
}

function colourOf(stack: string): DeploymentColor | undefined {
  if (stack.endsWith('-blue')) return 'blue';
  if (stack.endsWith('-green')) return 'green';
  return undefined;
}

/** The networks a colour serves on. The api is dual-homed; the web tier is
 *  not, and a disconnect from a network it never joined is a no-op. */
function servingNetworks(): string[] {
  return [`${getProjectId()}_internal`, 'tale-sandbox-net'];
}

/** `compose up` flags for one scope: recreate, then the replica counts. */
function upArgs(scope: ConvergeScope): string[] {
  return [
    'up',
    '-d',
    ...(scope.forceRecreate === true ? ['--force-recreate'] : []),
    ...scope.services.flatMap((service) => {
      const replicas = scope.scale?.[service];
      return replicas === undefined
        ? []
        : ['--scale', `${service}=${replicas}`];
    }),
    ...scope.services,
  ];
}

/**
 * Only what an instance readback carries. The environment is read to pick
 * the allow-listed keys and dropped: Docker's record holds every secret the
 * container was started with.
 */
const containerRecordSchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Image: z.string(),
  RestartCount: z.number().int().nonnegative(),
  State: z.object({
    Status: z.string(),
    StartedAt: z.string(),
  }),
  Config: z.object({
    Image: z.string(),
    Labels: z.record(z.string(), z.string()).nullable(),
    Env: z.array(z.string()).nullable(),
  }),
  Mounts: z
    .array(
      z.object({
        Type: z.string(),
        Name: z.string().optional(),
        Source: z.string(),
        Destination: z.string(),
        RW: z.boolean(),
      }),
    )
    .nullable(),
  NetworkSettings: z.object({
    Networks: z
      .record(z.string(), z.object({ IPAddress: z.string() }))
      .nullable(),
  }),
});

/** Docker's zero time for a container that never started. */
const NEVER_STARTED = /^0001-01-01T/;

function instanceInfoFromDocker(raw: string): InstanceInfo | null {
  let parsed: z.infer<typeof containerRecordSchema>[];
  try {
    parsed = z.array(containerRecordSchema).parse(JSON.parse(raw));
  } catch {
    // Neither the parser's context nor the record may reach a message: the
    // record holds the container's secrets.
    throw new Error('Docker returned an unreadable container record.');
  }
  const record = parsed[0];
  if (record === undefined) return null;
  const labels = record.Config.Labels ?? {};
  const environment: Record<string, string> = {};
  for (const entry of record.Config.Env ?? []) {
    const separator = entry.indexOf('=');
    if (separator > 0)
      environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  const stack = labels[PROJECT_LABEL] ?? '';
  const colour = colourOf(stack);
  const index = Number.parseInt(labels[NUMBER_LABEL] ?? '', 10);
  const address =
    Object.values(record.NetworkSettings.Networks ?? {})
      .map((network) => network.IPAddress)
      .find((ip) => ip !== '') ?? null;
  return {
    stack,
    service: labels[SERVICE_LABEL] ?? '',
    index: Number.isInteger(index) ? index : 0,
    ...(colour === undefined ? {} : { colour }),
    oneOff: (labels[ONEOFF_LABEL] ?? '').toLowerCase() === 'true',
    name: record.Name.replace(/^\//, ''),
    running: record.State.Status === 'running',
    state: record.State.Status,
    startedAt: NEVER_STARTED.test(record.State.StartedAt)
      ? null
      : record.State.StartedAt,
    restarted: record.RestartCount > 0,
    image: {
      reference: record.Config.Image,
      digest: record.Image === '' ? null : record.Image,
      version: labels['org.opencontainers.image.version'] ?? null,
      revision: labels['org.opencontainers.image.revision'] ?? null,
      automationWriterProtocol: labels[AUTOMATION_PROTOCOL_LABEL] ?? null,
    },
    environment: pickInstanceEnvironment(environment),
    environmentDigest: null,
    mounts: (record.Mounts ?? []).map((mount) => ({
      kind: mount.Type === 'volume' ? 'volume' : 'bind',
      source: mount.Name ?? mount.Source,
      target: mount.Destination,
      readOnly: !mount.RW,
    })),
    address,
    configDigest: null,
  };
}

export function createDockerRuntime(
  overrides: DockerRuntimeOverrides = {},
): StackRuntime {
  return {
    engine: 'docker',
    withdrawal: 'disconnect',
    snapshotKind: 'archive',

    // Readiness
    probe: (options) => (overrides.ensureDocker ?? ensureDocker)(options),
    checkReachable: () => checkDaemon(),
    checkEngine: () => probeDockerEngine(),

    // Census and readback
    list: async ({ stack, service }) => {
      const containers =
        service === undefined
          ? await listComposeContainers(stack)
          : await listComposeContainers(stack, service);
      const colour = colourOf(stack);
      return containers.map((container): InstanceSummary => {
        const summary: InstanceSummary = {
          stack,
          service: container.service,
          index: container.index,
          oneOff: false,
          name: container.name,
          running: container.running,
          state: container.state,
        };
        if (colour !== undefined) summary.colour = colour;
        return summary;
      });
    },
    listByName: async (fragment) =>
      (await listContainers(`name=${fragment}`)).map(({ name, status }) => ({
        name,
        status,
      })),
    exists: (name) => containerExists(name),
    isRunning: (name) => isContainerRunning(name),
    state: (name) => getContainerState(name),
    version: (name) => getContainerVersion(name),
    health: (name) => getContainerHealth(name),
    inspect: async (name) => {
      const result = await docker('container', 'inspect', name);
      if (!result.success) return null;
      return instanceInfoFromDocker(result.stdout);
    },

    // Images
    ensureImages: async (refs) => {
      // Every pull at once (Docker dedups shared layers), then the tags, as
      // a deploy has always done it.
      const pulled = await Promise.all(
        refs.map((ref) => pullImage(ref.reference)),
      );
      const failed: EnsuredImages['failed'] = [];
      for (const [index, ref] of refs.entries()) {
        if (pulled[index] !== true) {
          failed.push({ reference: ref.reference, detail: 'pull failed' });
          continue;
        }
        if (ref.alias === undefined) continue;
        const tagged = await exec('docker', ['tag', ref.reference, ref.alias]);
        if (!tagged.success)
          failed.push({
            reference: ref.reference,
            detail: tagged.stderr.trim(),
          });
      }
      return { failed };
    },
    inspectImage: (reference) =>
      readImageFacts(
        overrides.registry ?? createRegistryClient(),
        reference,
        overrides.platform ?? hostPlatform(),
      ),
    pull: (image) => pullImage(image),
    imagePresent: (image) => imagePresent(image),
    tag: (source, alias) => exec('docker', ['tag', source, alias]),

    // Volumes and networks
    volumeExists: (name) => volumeExists(name),
    ensureVolumes: (names, prefix) =>
      prefix === undefined
        ? ensureVolumes([...names])
        : ensureVolumes([...names], prefix),
    removeVolume: (name) => removeVolume(name),
    volumeRemovalHint: async (name) =>
      (await docker('volume', 'inspect', name)).success
        ? `docker volume rm ${name}`
        : null,
    migrateConfigVolume: async (prefix) => {
      await migrateConfigVolume(prefix);
    },
    ensureNetwork: (name) => ensureNetwork(name),
    ensureSandboxNetwork: () => ensureSandboxNetwork(),
    pruneNetworks: () =>
      docker(
        'network',
        'prune',
        '-f',
        '--filter',
        `label=project=${getProjectId()}`,
      ),
    volumeUsers: (volume) => listContainersUsingVolume(volume),
    quiesce: (volumes, work) => withVolumeContainersPaused(volumes, work),
    snapshot: () => Promise.reject(nativeSnapshotRefusal()),
    restoreSnapshot: () => Promise.reject(nativeSnapshotRefusal()),
    readVolumeFile: (volume, path, onChunk) =>
      streamOutOfVolume(volume, path, onChunk),
    writeVolumeFile: (volume, path, chunks) =>
      streamIntoVolume(volume, path, chunks),

    // Lifecycle
    converge: (target, scope) =>
      dockerCompose(target.compose, upArgs(scope), {
        projectName: target.stack,
        cwd: target.cwd,
      }),
    waitHealthy: (name, options) => waitForHealthy(name, options),
    waitServiceHealthy: (stack, service, options) =>
      waitForServiceHealthy(stack, service, options),
    stop: (name) => stopContainer(name),
    remove: (name) => removeContainer(name),
    // Compose attaches a replica to its serving networks as it starts it: a
    // colour takes traffic as soon as it listens.
    admit: async () => {},
    // Disconnecting cuts the replica's live connections: a flip calls it
    // after the drain (`withdrawal`).
    withdraw: (stack, services, replicas) =>
      detachColorFromNetworks(stack, services, servingNetworks(), replicas),
    onInterrupt: (stacks) => {
      for (const stack of stacks) {
        try {
          // Signal handlers must be synchronous, so the replica names are
          // resolved here rather than through the async lister.
          const listed = Bun.spawnSync([
            'docker',
            'ps',
            '-aq',
            ...composeCreatedContainerFilters(stack),
          ]);
          for (const id of listed.stdout
            .toString()
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)) {
            Bun.spawnSync(['docker', 'stop', '-t', '2', id]);
            Bun.spawnSync(['docker', 'rm', '-f', id]);
            logger.info(`Stopped ${id}`);
          }
        } catch (err) {
          // Best-effort cleanup: log so an operator can follow up manually.
          logger.warn(
            `Failed to clean up ${stack}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },

    // Exec, files, logs
    // `timeoutS` and `maxOutputBytes` are Incus's bounds: Docker keeps the
    // `docker exec` it always ran, which the command's own `timeout` bounds.
    exec: (name, argv, options = {}) =>
      options.stdin === undefined
        ? docker('exec', name, ...argv)
        : // `-i` streams `stdin` to the process: a payload never rides argv.
          exec('docker', ['exec', '-i', name, ...argv], {
            stdin: options.stdin,
          }),
    execSession: async (name, argv) =>
      Bun.spawn(['docker', 'exec', '-i', name, ...argv], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    copyIn: async (name, dir, target, owner) => {
      const source = dir.replaceAll('\\', '/');
      const copied = await exec('docker', [
        'cp',
        `${source}/.`,
        `${name}:${target}`,
      ]);
      if (!copied.success)
        return {
          success: false,
          stage: 'copy',
          detail: copied.stderr.trim(),
        };
      if (owner === undefined) return { success: true };
      // `docker cp` writes as root: hand the files to the app user.
      const chowned = await exec('docker', [
        'exec',
        name,
        'chown',
        '-R',
        `${owner.user}:${owner.group}`,
        target,
      ]);
      return chowned.success
        ? { success: true }
        : {
            success: false,
            stage: 'owner',
            detail: chowned.stderr.trim(),
          };
    },
    copyOut: async (name, source, dir, options) => {
      const copied = await exec(
        'docker',
        ['cp', `${name}:${source}/.`, `${dir}/`],
        { silent: true, timeout: options.timeoutS },
      );
      if (!copied.success) return copied;
      // `docker cp` cannot stop at a size, so the cap is checked on arrival.
      const received = await directoryBytes(dir);
      return received > options.maxBytes
        ? {
            success: false,
            stdout: '',
            stderr: `The copy of ${source} out of ${name} holds ${received} bytes, more than ${options.maxBytes}.`,
            exitCode: 1,
          }
        : copied;
    },
    logs: async (name, options, onLine) => {
      const args = [
        'logs',
        ...(options.follow ? ['--follow'] : []),
        ...(options.since === undefined ? [] : ['--since', options.since]),
        ...(options.tail === undefined ? [] : ['--tail', String(options.tail)]),
        name,
      ];
      if (onLine === undefined) {
        const proc = Bun.spawn(['docker', ...args], {
          stdout: 'inherit',
          stderr: 'inherit',
        });
        return proc.exited;
      }
      const proc = Bun.spawn(['docker', ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      // Uncapped: a log viewer shows a long line whole.
      await Promise.all([
        pipeLines(proc.stdout, onLine, Number.POSITIVE_INFINITY),
        pipeLines(proc.stderr, onLine, Number.POSITIVE_INFINITY),
        proc.exited,
      ]);
      return proc.exited;
    },

    // Helpers
    oneShot: (job) => {
      const args = [
        'run',
        '--rm',
        ...(job.stdin === undefined ? [] : ['-i']),
        ...job.mounts.flatMap((mount) => [
          '-v',
          `${mount.volume}:${mount.target}${mount.readOnly === true ? ':ro' : ''}`,
        ]),
        job.image,
        ...job.argv,
      ];
      const options = {
        ...(job.timeoutS === undefined ? {} : { timeout: job.timeoutS }),
        ...(job.stdin === undefined ? {} : { stdin: job.stdin }),
      };
      return Object.keys(options).length === 0
        ? exec('docker', args)
        : exec('docker', args, options);
    },
  };
}

/** Docker keeps no native volume snapshots: its snapshot is an archive. */
function nativeSnapshotRefusal(): Error {
  return preconditionError(
    'Docker keeps no native volume snapshots: a snapshot on Docker is a tar.gz archive of each volume, taken and restored with a one-shot job.',
  );
}

/** A path relative to a volume's root, as a snapshot's files are named. */
const VOLUME_FILE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function volumeFilePath(path: string): string {
  if (!VOLUME_FILE_PATH.test(path) || path.split('/').includes('..'))
    throw new Error(`Not a file path inside a volume: ${JSON.stringify(path)}`);
  return `/volume/${path}`;
}

async function helperFailure(
  proc: Bun.Subprocess<'ignore' | 'pipe', 'pipe' | 'ignore', 'pipe'>,
  what: string,
): Promise<void> {
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`${what} failed (exit ${code}): ${stderr.trim()}`);
}

/** `docker run --rm` the helper `cat` of one file, its output streamed. */
async function streamOutOfVolume(
  volume: string,
  path: string,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const proc = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '-v',
      `${volume}:/volume:ro`,
      BACKUP_HELPER_IMAGE,
      'cat',
      '--',
      volumeFilePath(path),
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const failure = helperFailure(proc, `Reading ${path} from ${volume}`);
  try {
    for await (const chunk of proc.stdout) await onChunk(chunk);
  } catch (error) {
    // The reader gave up (a size or hash mismatch): the helper goes too.
    proc.kill();
    await failure.catch((helperError: unknown) => {
      logger.debug(`Reading ${path} from ${volume}: ${String(helperError)}`);
    });
    throw error;
  }
  await failure;
}

/** `docker run --rm -i` the helper `cat >` one file, fed from `chunks`. */
async function streamIntoVolume(
  volume: string,
  path: string,
  chunks: AsyncIterable<Uint8Array>,
): Promise<void> {
  const proc = Bun.spawn(
    [
      'docker',
      'run',
      '--rm',
      '-i',
      '-v',
      `${volume}:/volume`,
      BACKUP_HELPER_IMAGE,
      'sh',
      '-c',
      'umask 077 && mkdir -p "$(dirname "$1")" && cat > "$1"',
      'sh',
      volumeFilePath(path),
    ],
    { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
  );
  const failure = helperFailure(proc, `Writing ${path} into ${volume}`);
  try {
    for await (const chunk of chunks) {
      proc.stdin.write(chunk);
      await proc.stdin.flush();
    }
  } finally {
    await proc.stdin.end();
  }
  await failure;
}

/** Every byte of every file below `dir`. */
async function directoryBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    total += (await stat(join(entry.parentPath, entry.name))).size;
  }
  return total;
}

/** The Docker runtime with today's collaborators: the default everywhere a
 *  caller does not pass the runtime its command selected. */
export const dockerRuntime: StackRuntime = createDockerRuntime();
