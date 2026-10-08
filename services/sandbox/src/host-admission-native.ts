// Concrete disabled boot boundary. A future reviewed boot configuration may
// opt in; today's server calls the default false and has no enabling env key.
import {
  HostAdmissionCoordinator,
  HostAdmissionUnavailable,
  type AdmissionContainer,
} from './host-admission-coordinator.ts';
import type { HostAdmissionReading } from './host-admission-model.ts';
import {
  DockerAdmissionOwner,
  type HostAdmissionOwnerIdentity,
} from './host-admission-owner.ts';
import { HostAdmissionProbe } from './host-admission-probe.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

const CID = /^[a-f0-9]{64}$/;
const PROJECTION =
  '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"status":{{json .State.Status}},"privileged":{{json .HostConfig.Privileged}},"pidMode":{{json .HostConfig.PidMode}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}';
type Docker = (args: string[], timeoutMs: number) => Promise<RunDockerResult>;
const docker: Docker = (args, timeoutMs) =>
  runDocker(args, {
    timeoutMs,
    priority: true,
    stdoutMaxBytes: 1024 * 1024,
    stderrMaxBytes: 1024,
  });

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HostAdmissionUnavailable();
  return Object.fromEntries(Object.entries(value));
}

export function requireNativeAdmissionConfig(
  cfg: Pick<
    SpawnerConfig,
    | 'backend'
    | 'runtimeTier'
    | 'dockerInContainer'
    | 'dockerBuildCache'
    | 'dockerWorkloads'
    | 'hub'
    | 'deviceConfigPath'
    | 'instance'
  >,
): void {
  if (
    cfg.backend !== 'docker' ||
    cfg.runtimeTier !== 'runc' ||
    cfg.dockerInContainer ||
    cfg.dockerBuildCache ||
    cfg.dockerWorkloads === undefined ||
    cfg.dockerWorkloads.length !== 0 ||
    cfg.hub !== null ||
    cfg.deviceConfigPath !== null ||
    cfg.instance !== ''
  )
    throw new HostAdmissionUnavailable();
}

/** Inspect every object on the daemon, without the normal per-instance
 * session filter. Known peers with host-write capability close admission,
 * including disabled/old spawners, DinD and independently-starting helpers.
 * This does not fence arbitrary host-root administrators or another daemon. */
export async function readNativeAdmissionInventory(
  owner: HostAdmissionOwnerIdentity,
  assertOwner: (budgetMs: number) => Promise<void>,
  run: Docker = docker,
  monotonic: () => number = () => performance.now(),
): Promise<readonly AdmissionContainer[]> {
  const deadline = monotonic() + 15_000;
  const output = async (args: string[]) => {
    const left = deadline - monotonic();
    if (left <= 0) throw new HostAdmissionUnavailable();
    const result = await run(args, Math.min(5000, left));
    if (
      monotonic() >= deadline ||
      result.exitCode !== 0 ||
      result.stdoutTruncated ||
      result.stderrTruncated
    )
      throw new HostAdmissionUnavailable();
    return result.stdout;
  };
  const list = async () => {
    const raw = await output([
      'ps',
      '--all',
      '--no-trunc',
      '--format',
      '{{.ID}}',
    ]);
    const ids = raw.trim().split('\n').filter(Boolean).sort();
    if (
      ids.length > 4096 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !CID.test(id))
    )
      throw new HostAdmissionUnavailable();
    return ids;
  };
  await assertOwner(Math.min(15_000, deadline - monotonic()));
  const ids = await list();
  if (!ids.includes(owner.containerId) || !ids.includes(owner.recordId))
    throw new HostAdmissionUnavailable();
  const rows: AdmissionContainer[] = [];
  for (let index = 0; index < ids.length; index += 32) {
    const batch = ids.slice(index, index + 32);
    const raw = await output(['inspect', '--format', PROJECTION, ...batch]);
    const projected = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => object(JSON.parse(line)));
    if (projected.length !== batch.length) throw new HostAdmissionUnavailable();
    for (const [offset, row] of projected.entries()) {
      if (
        row.id !== batch[offset] ||
        typeof row.name !== 'string' ||
        !row.name.startsWith('/') ||
        typeof row.running !== 'boolean' ||
        typeof row.status !== 'string' ||
        typeof row.privileged !== 'boolean' ||
        typeof row.pidMode !== 'string' ||
        !Array.isArray(row.mounts)
      )
        throw new HostAdmissionUnavailable();
      const labels = object(row.labels ?? {});
      const mounts = row.mounts.map(object);
      if (
        mounts.some(
          (mount) =>
            typeof mount.Source !== 'string' ||
            typeof mount.Destination !== 'string' ||
            typeof mount.Type !== 'string',
        )
      )
        throw new HostAdmissionUnavailable();
      const inertOwnerRecord =
        labels['tale.host-admission.version'] === '1' &&
        row.status === 'created' &&
        !row.running &&
        !row.privileged &&
        mounts.length === 0;
      if (row.id !== owner.containerId && !inertOwnerRecord) {
        const service = labels['com.docker.compose.service'];
        const socketOrRoot = mounts.some((mount) => {
          const source = String(mount.Source);
          const destination = String(mount.Destination);
          const containsSocket = (path: string) =>
            ['/var/run/docker.sock', '/run/docker.sock'].some(
              (socket) =>
                socket === path ||
                socket.startsWith(path.endsWith('/') ? path : `${path}/`),
            );
          return (
            containsSocket(destination) ||
            (mount.Type === 'bind' &&
              (source === '/' ||
                source === '/proc' ||
                source === '/dev' ||
                containsSocket(source) ||
                source.endsWith('/docker.sock') ||
                destination.endsWith('/docker.sock')))
          );
        });
        if (
          row.privileged ||
          row.pidMode === 'host' ||
          socketOrRoot ||
          labels['tale.docker'] === 'true' ||
          labels['tale.buildkitd'] === '1' ||
          labels['tale.registry-mirror'] === '1' ||
          (typeof service === 'string' &&
            /sandbox|spawner|buildkit/.test(service))
        )
          throw new HostAdmissionUnavailable();
      }
      const session = labels['tale.session'];
      if (
        session !== undefined &&
        (typeof session !== 'string' ||
          labels['tale.sandbox-instance'] !== undefined ||
          labels['tale.docker'] !== 'false' ||
          typeof labels['tale.create-attempt'] !== 'string' ||
          typeof labels['tale.created'] !== 'string' ||
          !/^\d+$/.test(labels['tale.created']))
      )
        throw new HostAdmissionUnavailable();
      rows.push({
        id: String(row.id),
        name: row.name.slice(1),
        running: row.running,
        ...(typeof session === 'string'
          ? {
              sessionId: session,
              createAttemptId: String(labels['tale.create-attempt']),
              createdAtMs: Number(labels['tale.created']),
            }
          : {}),
      });
    }
  }
  if (JSON.stringify(await list()) !== JSON.stringify(ids))
    throw new HostAdmissionUnavailable();
  await assertOwner(Math.min(15_000, deadline - monotonic()));
  if (monotonic() >= deadline) throw new HostAdmissionUnavailable();
  return rows;
}

/** Disabled is capacity-neutral and performs no Docker/filesystem reads.
 * Enabled initialization fails closed; never fall back to legacy admission. */
export async function bootNativeHostAdmission(
  cfg: SpawnerConfig,
  enabled = false,
): Promise<HostAdmissionCoordinator | undefined> {
  if (!enabled) return undefined;
  requireNativeAdmissionConfig(cfg);
  const owner = new DockerAdmissionOwner();
  const identity = await owner.acquire(true);
  const assertOwner = () => owner.assertCurrent();
  const probe = new HostAdmissionProbe(
    identity,
    (budget) => owner.assertCurrent(budget),
    { hostPath: cfg.hostSessionRoot, containerPath: cfg.hostSessionRoot },
  );
  const initial = await probe.read();
  const history: HostAdmissionReading[] = [initial];
  const readings = async (
    after: number,
  ): Promise<readonly [HostAdmissionReading, HostAdmissionReading]> => {
    const latest = await probe.read();
    const previous = history.findLast(
      (reading) =>
        reading.observedAt > after &&
        latest.observedAt - reading.observedAt >= 10_000 &&
        latest.observedAt - reading.observedAt <= 60_000,
    );
    if (latest.observedAt - (history.at(-1)?.observedAt ?? 0) >= 5_000)
      history.push(latest);
    while (
      history.length > 16 ||
      (history[0] && latest.observedAt - history[0].observedAt > 60_000)
    )
      history.shift();
    if (!previous) throw new HostAdmissionUnavailable();
    return [previous, latest];
  };
  return HostAdmissionCoordinator.open({
    root: cfg.hostSessionRoot,
    identity: initial.identity,
    assertOwner,
    inventory: () =>
      readNativeAdmissionInventory(identity, (budget) =>
        owner.assertCurrent(budget),
      ),
    readings,
    assertPriorRetired: (prior) => owner.assertPriorRetired(prior),
    memoryReserveBytes: cfg.session.minFreeMemoryBytes,
    diskReserveBytes: cfg.session.minFreeDiskBytes ?? 0,
  });
}
