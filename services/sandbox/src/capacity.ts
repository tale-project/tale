// Infrastructure observations, independent of the platform's quota ledger.
// Only aggregate host data and the requesting organization's session ids cross
// the signed capacity endpoint. A failed inventory must never become zero.

import { readFile } from 'node:fs/promises';
import { release } from 'node:os';

import {
  apiTimeout,
  makeK8sClient,
  type K8sClient,
} from './backend/kubernetes/k8s-client.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

export type RuntimeState = 'running' | 'starting' | 'stopped';

export interface RuntimeObservation {
  sessionId: string | null;
  organizationId: string | null;
  state: RuntimeState;
}

export interface HostResources {
  cpu: { totalCores: number | null; usedCores: number | null };
  memory: { totalBytes: number | null; usedBytes: number | null };
}

export interface SandboxCapacity {
  status: 'available';
  observedAt: number;
  backend: 'docker' | 'kubernetes';
  scope: 'host' | 'namespace';
  sessions: {
    running: number;
    starting: number;
    limit: number;
    organizationRunning: number;
    organizationStarting: number;
    organizationLimit: number;
  };
  resources: HostResources;
  runtimeSessions: Array<{ sessionId: string; state: RuntimeState }>;
}

interface InfrastructureSnapshot {
  observedAt: number;
  sessions: RuntimeObservation[];
  resources: HostResources;
}

function unavailableResources(): HostResources {
  return {
    cpu: { totalCores: null, usedCores: null },
    memory: { totalBytes: null, usedBytes: null },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function observation(
  sessionId: unknown,
  organizationId: unknown,
  state: RuntimeState,
): RuntimeObservation {
  // Broken ownership labels do not make the underlying compute disappear.
  // Keep it in aggregate counts, but never manufacture a tenant/session id.
  return {
    sessionId:
      typeof sessionId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)
        ? sessionId
        : null,
    organizationId:
      typeof organizationId === 'string' &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(organizationId)
        ? organizationId
        : null,
    state,
  };
}

/** Docker inventories all session containers, including warming and exited
 * ones. Paused containers still hold compute; restarting ones are starting. */
function parseDockerSessions(stdout: string): RuntimeObservation[] {
  const sessions: RuntimeObservation[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const row = record(JSON.parse(line));
    if (row === null || typeof row.state !== 'string') {
      throw new Error('Invalid Docker session inventory');
    }
    // An unfamiliar state must not silently free capacity; only states that
    // confirm termination stop counting as occupied.
    const state = ['exited', 'dead', 'removing'].includes(row.state)
      ? 'stopped'
      : row.state === 'created' || row.state === 'restarting'
        ? 'starting'
        : 'running';
    sessions.push(observation(row.sessionId, row.organizationId, state));
  }
  return sessions;
}

export interface CpuCounters {
  total: number;
  idle: number;
  cores: number;
}

/** /proc/stat guest times are already included in user/nice; sum the first
 * eight counters only. I/O wait is idle here. See docs.kernel.org/filesystems/proc.html. */
export function parseCpuCounters(stat: string): CpuCounters | null {
  const line = stat.split('\n').find((entry) => /^cpu\s/.test(entry));
  if (line === undefined) return null;
  const times = line.trim().split(/\s+/).slice(1, 9).map(Number);
  const cores = stat
    .split('\n')
    .filter((entry) => /^cpu\d+\s/.test(entry)).length;
  if (
    times.length < 4 ||
    cores < 1 ||
    times.some((value) => !Number.isFinite(value) || value < 0)
  )
    return null;
  return {
    total: times.reduce((sum, value) => sum + value, 0),
    idle: (times[3] ?? 0) + (times[4] ?? 0),
    cores,
  };
}

export function usedCpuCores(
  before: CpuCounters | null,
  after: CpuCounters,
): number | null {
  if (before === null || before.cores !== after.cores) return null;
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0 || idle < 0 || idle > total) return null;
  return ((total - idle) / total) * after.cores;
}

/** MemAvailable includes reclaimable cache; MemFree alone exaggerates usage. */
export function parseMemory(meminfo: string): {
  totalBytes: number;
  usedBytes: number;
} | null {
  const read = (key: string): number | null => {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
    return match ? positive(Number(match[1]) * 1024) : null;
  };
  const total = read('MemTotal');
  // Zero available memory is a valid observation, unlike an absent field.
  const availableMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  const available = availableMatch ? Number(availableMatch[1]) * 1024 : null;
  if (
    total === null ||
    available === null ||
    available < 0 ||
    available > total
  )
    return null;
  return { totalBytes: total, usedBytes: total - available };
}

function commandOutput(result: RunDockerResult): string {
  if (result.exitCode !== 0 || result.stdoutTruncated) {
    throw new Error('Docker capacity observation failed');
  }
  return result.stdout;
}

interface CapacityDependencies {
  docker?: typeof runDocker;
  read?: (path: string) => Promise<string>;
  kernelRelease?: () => string;
  client?: K8sClient;
  now?: () => number;
}

/** One observer per spawner. The five-second inventory cache and in-flight
 * coalescing bound diagnostic work; session ownership is filtered per request. */
export class CapacityReader {
  private cached: InfrastructureSnapshot | null = null;
  private inFlight: Promise<InfrastructureSnapshot> | null = null;
  private previousCpu: CpuCounters | null = null;
  private previousCpuAt = 0;
  private readonly docker: typeof runDocker;
  private readonly read: (path: string) => Promise<string>;
  private readonly kernelRelease: () => string;
  private readonly now: () => number;
  private readonly client: K8sClient | undefined;

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly creating: () => ReadonlyMap<string, string>,
    deps: CapacityDependencies = {},
  ) {
    this.docker = deps.docker ?? runDocker;
    this.read = deps.read ?? ((path) => readFile(path, 'utf8'));
    this.kernelRelease = deps.kernelRelease ?? release;
    this.now = deps.now ?? Date.now;
    this.client =
      cfg.backend === 'kubernetes'
        ? (deps.client ?? makeK8sClient(cfg.k8s.namespace))
        : undefined;
  }

  async forOrganization(organizationId: string): Promise<SandboxCapacity> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(organizationId)) {
      throw new Error('Invalid organization id');
    }
    const snapshot = await this.snapshot();
    const sessions = new Map(
      snapshot.sessions.map((session) => [
        session.sessionId !== null && session.organizationId !== null
          ? JSON.stringify([session.organizationId, session.sessionId])
          : Symbol(),
        session,
      ]),
    );
    // A create can predate the Docker/Pod object and must count exactly once.
    for (const [sessionId, org] of this.creating()) {
      sessions.set(JSON.stringify([org, sessionId]), {
        sessionId,
        organizationId: org,
        state: 'starting',
      });
    }
    const all = [...sessions.values()];
    const own = all.filter(
      (session) => session.organizationId === organizationId,
    );
    const count = (rows: RuntimeObservation[], state: RuntimeState) =>
      rows.filter((session) => session.state === state).length;
    return {
      status: 'available',
      observedAt: snapshot.observedAt,
      backend: this.cfg.backend,
      scope: this.cfg.backend === 'docker' ? 'host' : 'namespace',
      sessions: {
        running: count(all, 'running'),
        starting: count(all, 'starting'),
        limit: this.cfg.session.maxSessions,
        organizationRunning: count(own, 'running'),
        organizationStarting: count(own, 'starting'),
        organizationLimit: this.cfg.session.maxSessionsPerOrg,
      },
      resources: snapshot.resources,
      runtimeSessions: own.flatMap(({ sessionId, state }) =>
        sessionId === null ? [] : [{ sessionId, state }],
      ),
    };
  }

  private snapshot(): Promise<InfrastructureSnapshot> {
    if (this.cached !== null && this.now() - this.cached.observedAt < 5_000) {
      return Promise.resolve(this.cached);
    }
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.observe()
      .then((snapshot) => {
        this.cached = snapshot;
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async observe(): Promise<InfrastructureSnapshot> {
    if (this.client !== undefined) {
      const response = await this.client.core.listNamespacedPod(
        {
          namespace: this.cfg.k8s.namespace,
          labelSelector: 'tale.sandbox/role=session',
        },
        apiTimeout(),
      );
      if (
        !Array.isArray(response.items) ||
        response.metadata?._continue ||
        (response.metadata?.remainingItemCount ?? 0) > 0
      ) {
        throw new Error('Incomplete session Pod inventory');
      }
      const sessions: RuntimeObservation[] = [];
      for (const pod of response.items) {
        const annotations = pod.metadata?.annotations;
        const sessionId = annotations?.['tale.dev/session-id'];
        const organizationId = annotations?.['tale.dev/organization-id'];
        const phase = pod.status?.phase;
        // An unreachable node can leave a Pod Unknown while its workload is
        // still running. Count any unrecognized phase as occupied until the
        // control plane confirms termination; do not fail healthy neighbors.
        sessions.push(
          observation(
            sessionId,
            organizationId,
            phase === 'Succeeded' || phase === 'Failed'
              ? 'stopped'
              : phase === 'Pending' || phase === undefined
                ? 'starting'
                : 'running',
          ),
        );
      }
      // Namespace-scoped credentials do not reveal cluster node capacity or
      // metrics. Never substitute the spawner Pod's cgroup for cluster capacity.
      return {
        observedAt: this.now(),
        sessions,
        resources: unavailableResources(),
      };
    }

    const [inventory, resources] = await Promise.allSettled([
      this.docker(
        [
          'ps',
          '--all',
          '--filter',
          'label=tale.sandbox-session=1',
          '--format',
          '{"sessionId":{{json (.Label "tale.session")}},"organizationId":{{json (.Label "tale.org")}},"state":{{json .State}}}',
        ],
        { timeoutMs: 5_000, stdoutMaxBytes: 1_048_576 },
      ).then(commandOutput),
      this.observeHost(),
    ]);
    if (inventory.status === 'rejected') throw inventory.reason;
    return {
      observedAt: this.now(),
      sessions: parseDockerSessions(inventory.value),
      resources:
        resources.status === 'fulfilled'
          ? resources.value
          : unavailableResources(),
    };
  }

  private async observeHost(): Promise<HostResources> {
    const info = record(
      JSON.parse(
        commandOutput(
          await this.docker(
            [
              'info',
              '--format',
              '{"cpus":{{json .NCPU}},"memory":{{json .MemTotal}},"kernel":{{json .KernelVersion}}}',
            ],
            { timeoutMs: 5_000, stdoutMaxBytes: 16_384 },
          ),
        ),
      ),
    );
    const resources: HostResources = {
      cpu: { totalCores: positive(info?.cpus), usedCores: null },
      memory: { totalBytes: positive(info?.memory), usedBytes: null },
    };
    // Standard local socket only. With a remote daemon or Docker Desktop,
    // the spawner's /proc can describe another machine: retain daemon totals,
    // but leave usage unknown. Totals/kernel must agree as a second guard.
    let endpoint: unknown;
    try {
      endpoint =
        !process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST
          ? process.env.DOCKER_HOST
          : JSON.parse(
              commandOutput(
                await this.docker(
                  [
                    'context',
                    'inspect',
                    '--format',
                    '{{json .Endpoints.docker.Host}}',
                  ],
                  { timeoutMs: 5_000, stdoutMaxBytes: 4_096 },
                ),
              ),
            );
    } catch {
      this.previousCpu = null;
      return resources;
    }
    if (
      (endpoint !== 'unix:///var/run/docker.sock' &&
        endpoint !== 'unix:///run/docker.sock') ||
      info?.kernel !== this.kernelRelease()
    ) {
      this.previousCpu = null;
      return resources;
    }
    const [stat, meminfo] = await Promise.allSettled([
      this.read('/proc/stat'),
      this.read('/proc/meminfo'),
    ]);
    const memory =
      meminfo.status === 'fulfilled' ? parseMemory(meminfo.value) : null;
    const cpu =
      stat.status === 'fulfilled' ? parseCpuCounters(stat.value) : null;
    if (memory?.totalBytes !== resources.memory.totalBytes) {
      this.previousCpu = null;
      return resources;
    }
    if (memory !== null) resources.memory.usedBytes = memory.usedBytes;
    if (cpu !== null && cpu.cores === resources.cpu.totalCores) {
      const sampledAt = this.now();
      // Polls normally arrive every 15 seconds. Re-prime after a closed or
      // throttled page: an hour-long average is not a current usage reading.
      resources.cpu.usedCores = usedCpuCores(
        sampledAt - this.previousCpuAt <= 30_000 ? this.previousCpu : null,
        cpu,
      );
      this.previousCpu = cpu;
      this.previousCpuAt = sampledAt;
    } else this.previousCpu = null;
    return resources;
  }
}
