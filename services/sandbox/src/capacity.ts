// Infrastructure observations, independent of the platform's quota ledger.
// Only aggregate host data and the requesting organization's session ids cross
// the signed capacity endpoint. A failed inventory must never become zero.

import { readFile } from 'node:fs/promises';
import { release } from 'node:os';

import type { K8sClient } from './backend/kubernetes/k8s-client.ts';
import {
  type CpuCounters,
  parseCpuCounters,
  parseMemory,
  usedCpuCores,
} from './proc-stats.ts';
import {
  belongsToInstance,
  SESSION_INSTANCE_LABEL,
  sessionInstanceFilter,
} from './session/session-naming.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';

export type RuntimeState = 'running' | 'starting' | 'stopped';

/** Polls normally arrive every 15 seconds; an older previous sample would
 * average over a closed or hidden page, which is not a current reading. */
const PREVIOUS_CPU_SAMPLE_MAX_AGE_MS = 30_000;
/** How long an unprimed poll waits for its own second sample. */
const CPU_PRIME_SAMPLE_MS = 1_000;
/** How long the host's fixed facts hold: its CPU count, memory total and
 * kernel, and whether this process's /proc describes it. They change only
 * with a daemon or host restart, and each read forks the Docker CLI while the
 * live inventory is already one fork per five seconds. */
const HOST_FACTS_TTL_MS = 10 * 60_000;
/** A Docker endpoint that could not be resolved is asked again sooner, so a
 * busy CLI does not hide host usage for ten minutes. */
const UNRESOLVED_ENDPOINT_TTL_MS = 30_000;

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
    /** @deprecated Compatibility alias of the deployment limit; no org cap. */
    organizationLimit: number;
  };
  resources: HostResources;
  runtimeSessions: Array<{
    sessionId: string;
    state: RuntimeState;
    /** Set for a session running on one of the organization's devices. */
    deviceId?: string;
  }>;
  /** Where the organization's device-placed sessions live (hub only). */
  placements?: Array<{ sessionId: string; deviceId: string }>;
}

interface InfrastructureSnapshot {
  observedAt: number;
  sessions: RuntimeObservation[];
  resources: HostResources;
}

interface HostFacts {
  observedAt: number;
  ttlMs: number;
  totalCores: number | null;
  totalBytes: number | null;
  /** This process's /proc describes the Docker host: the standard local
   * socket and the daemon's own kernel. Totals must still agree per read. */
  local: boolean;
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
function parseDockerSessions(
  stdout: string,
  instance = '',
): RuntimeObservation[] {
  const sessions: RuntimeObservation[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const row = record(JSON.parse(line));
    if (row === null || typeof row.state !== 'string') {
      throw new Error('Invalid Docker session inventory');
    }
    // Another spawner's sessions on the same daemon are its compute to count.
    if (
      !belongsToInstance(
        typeof row.instance === 'string' ? row.instance : '',
        instance,
      )
    ) {
      continue;
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
  sleep?: (ms: number) => Promise<void>;
}

/** One observer per spawner. The five-second inventory cache and in-flight
 * coalescing bound diagnostic work; session ownership is filtered per request. */
export class CapacityReader {
  private cached: InfrastructureSnapshot | null = null;
  private inFlight: Promise<InfrastructureSnapshot> | null = null;
  private previousCpu: CpuCounters | null = null;
  private previousCpuAt = 0;
  private hostFacts: HostFacts | null = null;
  private hostFactsInFlight: Promise<HostFacts> | null = null;
  /** Whether the current run of unresolvable endpoints has been reported:
   * once per run, not every 30 s while the page is polled. */
  private endpointWarned = false;
  private readonly docker: typeof runDocker;
  private readonly read: (path: string) => Promise<string>;
  private readonly kernelRelease: () => string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private client: K8sClient | undefined;

  constructor(
    private readonly cfg: SpawnerConfig,
    private readonly creating: () => ReadonlyMap<string, string>,
    deps: CapacityDependencies = {},
  ) {
    this.docker = deps.docker ?? runDocker;
    this.read = deps.read ?? ((path) => readFile(path, 'utf8'));
    this.kernelRelease = deps.kernelRelease ?? release;
    this.now = deps.now ?? Date.now;
    this.sleep =
      deps.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.client = deps.client;
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
        organizationLimit: this.cfg.session.maxSessions,
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
    if (this.cfg.backend === 'kubernetes') {
      // The Kubernetes API client is loaded only where it is used: it holds
      // about 100 MiB resident, which a Docker spawner never needs.
      const { apiTimeout, makeK8sClient } =
        await import('./backend/kubernetes/k8s-client.ts');
      this.client ??= makeK8sClient(this.cfg.k8s.namespace);
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
          ...sessionInstanceFilter(this.cfg.instance),
          '--format',
          `{"sessionId":{{json (.Label "tale.session")}},"organizationId":{{json (.Label "tale.org")}},"state":{{json .State}},"instance":{{json (.Label "${SESSION_INSTANCE_LABEL}")}}}`,
        ],
        { timeoutMs: 5_000, stdoutMaxBytes: 1_048_576 },
      ).then(commandOutput),
      this.observeHost(),
    ]);
    if (inventory.status === 'rejected') throw inventory.reason;
    return {
      observedAt: this.now(),
      sessions: parseDockerSessions(inventory.value, this.cfg.instance),
      resources:
        resources.status === 'fulfilled'
          ? resources.value
          : unavailableResources(),
    };
  }

  /** The host's fixed facts, read at most once per HOST_FACTS_TTL_MS;
   * concurrent snapshots share one read. A failed `docker info` is not kept:
   * the next snapshot asks again. */
  private readHostFacts(): Promise<HostFacts> {
    const facts = this.hostFacts;
    if (facts !== null && this.now() - facts.observedAt < facts.ttlMs) {
      return Promise.resolve(facts);
    }
    this.hostFactsInFlight ??= this.observeHostFacts()
      .then((observed) => {
        this.hostFacts = observed;
        return observed;
      })
      .finally(() => {
        this.hostFactsInFlight = null;
      });
    return this.hostFactsInFlight;
  }

  private async observeHostFacts(): Promise<HostFacts> {
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
    const facts: HostFacts = {
      observedAt: this.now(),
      ttlMs: HOST_FACTS_TTL_MS,
      totalCores: positive(info?.cpus),
      totalBytes: positive(info?.memory),
      local: false,
    };
    // Standard local socket only. With a remote daemon or Docker Desktop,
    // the spawner's /proc can describe another machine: retain daemon totals,
    // but leave usage unknown. Totals/kernel must agree as a second guard.
    // The spawner image sets DOCKER_HOST, so only a spawner run outside it
    // asks the CLI for its context's endpoint.
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
    } catch (error) {
      if (!this.endpointWarned) {
        this.endpointWarned = true;
        console.warn(
          `[sandbox] cannot resolve the Docker endpoint; host usage stays unknown (asked again every ${UNRESOLVED_ENDPOINT_TTL_MS / 1000} s, reported once until it resolves):`,
          error,
        );
      }
      facts.ttlMs = UNRESOLVED_ENDPOINT_TTL_MS;
      return facts;
    }
    this.endpointWarned = false;
    facts.local =
      (endpoint === 'unix:///var/run/docker.sock' ||
        endpoint === 'unix:///run/docker.sock') &&
      info?.kernel === this.kernelRelease();
    return facts;
  }

  private async observeHost(): Promise<HostResources> {
    const facts = await this.readHostFacts();
    const resources: HostResources = {
      cpu: { totalCores: facts.totalCores, usedCores: null },
      memory: { totalBytes: facts.totalBytes, usedBytes: null },
    };
    if (!facts.local) {
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
      let sampledAt = this.now();
      let before =
        sampledAt - this.previousCpuAt <= PREVIOUS_CPU_SAMPLE_MAX_AGE_MS
          ? this.previousCpu
          : null;
      let after = cpu;
      if (before === null) {
        // Usage is the change between two samples. The first poll, and the
        // first one after a closed or hidden page, has nothing recent to
        // compare to; only the page polls, so nothing else primes it. Take
        // the second sample here instead of answering unknown for a poll.
        await this.sleep(CPU_PRIME_SAMPLE_MS);
        let second: CpuCounters | null = null;
        try {
          second = parseCpuCounters(await this.read('/proc/stat'));
        } catch (error) {
          console.warn('[sandbox] second CPU sample failed:', error);
        }
        if (second !== null) {
          before = cpu;
          after = second;
          sampledAt = this.now();
        }
      }
      resources.cpu.usedCores = usedCpuCores(before, after);
      this.previousCpu = after;
      this.previousCpuAt = sampledAt;
    } else this.previousCpu = null;
    return resources;
  }
}
