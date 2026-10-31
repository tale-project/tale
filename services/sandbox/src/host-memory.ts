// What the Docker host has left in memory, for admission and capacity sizing,
// and whether the session capacity fits it with every agent session at its
// memory limit (the warning the spawner logs once it reads the host).
//
// A session's memory limit is a ceiling, not a reservation: an idle session
// uses ~60 MB and an agent turn a few hundred, so counting sessions alone
// either wastes most of a large host or lets a small one be overcommitted
// until the kernel's OOM killer picks sessions. The spawner reads the host's
// MemAvailable instead and admits a session only while the host would keep
// its reserve free. That reading is only trusted where /proc describes the
// Docker host: the standard local socket, the same kernel and the same total
// as the daemon reports (a remote daemon, or a context pointing elsewhere,
// leaves admission to the session count alone).
//
// The same judgement decides where the host's pressure is read
// (host-pressure.ts): the load and the kernel's pressure stall information
// describe the Docker host only where its memory does.

import { release } from 'node:os';

import { parseMemory } from './proc-stats.ts';
import { sessionAgentProfile } from './session/session-profile.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';
import type { SpawnerConfig } from './types.ts';
import type { SandboxSessionProfile } from './wire.ts';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** What one session typically holds while it works: an agent turn (the CLI
 * and its MCP servers), a turn with its inner Docker daemon, a crawler render
 * (Chromium and a few pages). Admission keeps this much per starting session
 * beyond the reserve. */
const SESSION_WORKING_SET_BYTES = {
  agent: 512 * MIB,
  dind: 1536 * MIB,
  default: 512 * MIB,
} as const;

/** The memory a session slot is sized with when capacity follows the host:
 * between an idle session and a heavy turn, so a busy fleet still fits —
 * and a whole Docker-in-sandbox turn where agent sessions run their own
 * daemon. */
const SIZING_BYTES_PER_SESSION = 768 * MIB;
const AUTO_MIN_SESSIONS = 8;
const AUTO_MAX_SESSIONS = 256;
/** The CPU pressure (PSI `some avg10`, in percent, counted as far as the
 * host's CPUs are busy) from which admission lets sessions start one at a
 * time under the `default` preset, unless
 * SANDBOX_CPU_PRESSURE_PERCENT says otherwise. */
export const DEFAULT_CPU_PRESSURE_PERCENT = 60;

/** Sessions per CPU when capacity follows the host: an agent session may use
 * two CPUs while it works, and most of a fleet idles on a model's answer at
 * any one time. */
const AUTO_SESSIONS_PER_CPU = 2;

export interface HostMemory {
  totalBytes: number;
  availableBytes: number;
}

/** The memory admission always leaves free: the operator's, else a tenth of
 * the host and at least 1 GiB (the platform, its databases and the page cache
 * live on the same machine). */
export function memoryReserveBytes(
  totalBytes: number,
  configuredBytes?: number,
): number {
  return configuredBytes ?? Math.max(GIB, Math.floor(totalBytes / 10));
}

/** The session capacity a host of this size gets when the operator set none:
 * what its memory fits, at most two sessions per CPU where the daemon reports
 * its CPUs, never below the fixed default it replaces, never above 256. */
export function autoSessionCapacity(
  totalBytes: number,
  reserveBytes: number,
  dockerInside = false,
  dockerWorkloads?: SpawnerConfig['dockerWorkloads'],
  cpus: number | null = null,
): number {
  if (reserveBytes >= totalBytes) {
    throw new Error(
      'SANDBOX_MIN_FREE_MEMORY must be below the Docker host total memory',
    );
  }
  const perSession = Math.max(
    SIZING_BYTES_PER_SESSION,
    sessionWorkingSetBytes(
      'agent',
      dockerInside && dockerWorkloads?.length !== 0,
    ),
  );
  const memoryFits = Math.floor((totalBytes - reserveBytes) / perSession);
  const fits =
    cpus === null
      ? memoryFits
      : Math.min(memoryFits, Math.floor(cpus * AUTO_SESSIONS_PER_CPU));
  return Math.min(AUTO_MAX_SESSIONS, Math.max(AUTO_MIN_SESSIONS, fits));
}

/** The working set admission plans for a session of this kind. */
export function sessionWorkingSetBytes(
  profile: SandboxSessionProfile,
  dockerInside: boolean,
): number {
  if (profile === 'agent-light') return SESSION_WORKING_SET_BYTES.agent;
  if (profile !== 'agent') return SESSION_WORKING_SET_BYTES.default;
  return dockerInside
    ? SESSION_WORKING_SET_BYTES.dind
    : SESSION_WORKING_SET_BYTES.agent;
}

/** A Docker memory size (`8g`, `1536m`, `4294967296`) in bytes, or null. */
export function dockerMemoryBytes(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([bkmg])?$/i.exec(value.trim());
  if (!m) return null;
  const unit = { b: 1, k: 1024, m: MIB, g: GIB }[(m[2] ?? 'b').toLowerCase()];
  return unit === undefined ? null : Number(m[1]) * unit;
}

/** What the session capacity is weighed with. */
type SessionCapacityConfig = Pick<
  SpawnerConfig,
  'session' | 'dockerInContainer' | 'dockerWorkloads' | 'deviceConfigPath'
>;

/** The memory limit of the largest agent session this spawner starts: one
 * with Docker inside wherever a workload may run it. Null where that limit is
 * no size this reads. */
export function agentSessionMemoryBytes(
  cfg: SessionCapacityConfig,
): number | null {
  const bytes = dockerMemoryBytes(
    sessionAgentProfile(
      cfg,
      cfg.dockerInContainer && cfg.dockerWorkloads?.length !== 0,
    ).memory,
  );
  return bytes === null || bytes <= 0 ? null : Math.floor(bytes);
}

function gib(bytes: number): string {
  return `${Number((bytes / GIB).toFixed(1))} GiB`;
}

/** The warning a session capacity gets when that many agent sessions, each
 * at its memory limit, would need more than the host has for them after its
 * reserve; null where they fit. `explicit`: SANDBOX_MAX_SESSIONS set the
 * capacity, which turns memory admission off. */
export function sessionMemoryWarning(
  figures: {
    sessions: number;
    sessionBytes: number;
    totalBytes: number;
    reserveBytes: number;
  },
  explicit: boolean,
): string | null {
  const { sessions, sessionBytes, totalBytes, reserveBytes } = figures;
  const needed = sessions * sessionBytes;
  const left = Math.max(0, totalBytes - reserveBytes);
  if (needed <= left) return null;
  const sizing = `${sessions} session${sessions === 1 ? '' : 's'} (${explicit ? 'SANDBOX_MAX_SESSIONS' : 'sized from the host'}) of up to ${gib(sessionBytes)} each (SANDBOX_AGENT_MEMORY) can use ${gib(needed)}, more than the ${gib(left)} the host has for them: ${gib(totalBytes)} less its ${gib(reserveBytes)} reserve (SANDBOX_MIN_FREE_MEMORY).`;
  return explicit
    ? `[sandbox] ${sizing} With SANDBOX_MAX_SESSIONS set, memory admission is off, so sessions working at once can run the host out of memory: lower SANDBOX_MAX_SESSIONS or SANDBOX_AGENT_MEMORY, or unset SANDBOX_MAX_SESSIONS to size the capacity from the host and hold starts while its memory is short.`
    : `[sandbox] ${sizing} A start waits while the host's memory is short, but running sessions can still grow to their limits together: set SANDBOX_MAX_SESSIONS or SANDBOX_AGENT_MEMORY lower if many work at once.`;
}

/** The session capacity once the host's memory is read: the operator's
 * SANDBOX_MAX_SESSIONS where set, else sized from the host (`sized`), with
 * the warning sessionMemoryWarning gives it. Neither is cut to fit: an
 * explicit capacity is the operator's, and a sized one plans on the working
 * set, with memory admission holding each start while memory is short. A
 * device's spawner never warns: its capacity is the one `tale sandbox
 * connect` chose, not a setting of its own. */
export function hostSessionCapacity(
  cfg: SessionCapacityConfig,
  totalBytes: number,
  cpus: number | null,
): { maxSessions: number; sized: boolean; warning: string | null } {
  const reserveBytes = memoryReserveBytes(
    totalBytes,
    cfg.session.minFreeMemoryBytes,
  );
  const sized = cfg.session.autoMaxSessions === true;
  const maxSessions = sized
    ? autoSessionCapacity(
        totalBytes,
        reserveBytes,
        cfg.dockerInContainer,
        cfg.dockerWorkloads,
        cpus,
      )
    : cfg.session.maxSessions;
  const sessionBytes = agentSessionMemoryBytes(cfg);
  const warning =
    sessionBytes === null || cfg.deviceConfigPath !== null
      ? null
      : sessionMemoryWarning(
          { sessions: maxSessions, sessionBytes, totalBytes, reserveBytes },
          !sized,
        );
  return { maxSessions, sized, warning };
}

/** A MemAvailable reading may be reused this long: a burst of creates reads
 * the file once, and in-flight creates are accounted for separately. */
const READING_TTL_MS = 1_000;
/** How long the verdict "this /proc describes the Docker host" holds. */
const VERDICT_TTL_MS = 10 * 60_000;
/** How long a verdict the Docker CLI could not reach holds: a busy daemon
 * right after a reboot must not switch the memory guard off for ten
 * minutes. */
const FAILED_VERDICT_TTL_MS = 30_000;

export interface HostMemoryDeps {
  docker?: (args: string[]) => Promise<RunDockerResult>;
  readFile?: (path: string) => Promise<string>;
  kernelRelease?: () => string;
  now?: () => number;
  env?: Record<string, string | undefined>;
}

export class HostMemoryProbe {
  private readonly docker: (args: string[]) => Promise<RunDockerResult>;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly kernelRelease: () => string;
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private verdict: {
    local: boolean;
    atMs: number;
    totalBytes: number;
    cpus: number | null;
    failed: boolean;
  } | null = null;
  private judging: Promise<boolean> | null = null;
  private reading: {
    atMs: number;
    memory: HostMemory | null;
  } | null = null;
  private refreshing: Promise<HostMemory | null> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HostMemoryDeps = {}) {
    // Short calls: a burst of creates holding every shared docker CLI slot
    // must not switch the memory guard off.
    this.docker =
      deps.docker ??
      ((args) => runDocker(args, { timeoutMs: 5_000, priority: true }));
    this.readFile = deps.readFile ?? ((path) => Bun.file(path).text());
    this.kernelRelease = deps.kernelRelease ?? release;
    this.now = deps.now ?? Date.now;
    this.env = deps.env ?? process.env;
  }

  /** Keep the reading fresh: one read a second, so admission, which
   * decides without waiting, never judges a create on an old one. */
  start(): void {
    if (this.ticker !== null) return;
    this.ticker = setInterval(() => {
      void this.read().catch((error: unknown) => {
        console.warn('[sandbox] host memory refresh failed:', error);
      });
    }, READING_TTL_MS);
    this.ticker.unref();
  }

  stop(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** The last reading, without waiting: what admission decides with inside
   * its lock — about a second old once `start()` keeps it fresh. Null until
   * the first reading lands, and where this process cannot see the Docker
   * host's memory. */
  latest(): HostMemory | null {
    return this.reading?.memory ?? null;
  }

  /** Whether this process's /proc describes the Docker host: the verdict
   * the memory reading itself rests on, judged at most every ten minutes
   * (sooner after the Docker CLI could not answer). Never rejects. */
  describesHost(): Promise<boolean> {
    return this.describesDockerHost();
  }

  /** The CPUs the daemon reports for the Docker host this process shares,
   * from the last verdict: null until the host is found to be the Docker
   * host. */
  cpus(): number | null {
    return this.verdict?.local === true ? this.verdict.cpus : null;
  }

  /** The host's memory, or null when this process cannot see the Docker
   * host's (never a guess: null leaves admission to the session count). A
   * reading under a second old is reused and concurrent callers share one
   * read, unless `fresh` asks for one taken after the call. */
  read(fresh = false): Promise<HostMemory | null> {
    const reading = this.reading;
    if (
      !fresh &&
      reading !== null &&
      this.now() - reading.atMs < READING_TTL_MS
    ) {
      return Promise.resolve(reading.memory);
    }
    if (fresh) return this.readNow();
    this.refreshing ??= this.readNow().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async readNow(): Promise<HostMemory | null> {
    const now = this.now();
    let memory: HostMemory | null = null;
    if (await this.describesDockerHost()) {
      try {
        const parsed = parseMemory(await this.readFile('/proc/meminfo'));
        if (parsed !== null && parsed.totalBytes === this.verdict?.totalBytes) {
          memory = {
            totalBytes: parsed.totalBytes,
            availableBytes: parsed.totalBytes - parsed.usedBytes,
          };
        }
      } catch (error) {
        console.warn('[sandbox] cannot read the host memory:', error);
      }
    }
    // A slower read that started earlier never replaces a newer reading.
    if (this.reading === null || this.reading.atMs <= now) {
      this.reading = { atMs: now, memory };
    }
    return memory;
  }

  private describesDockerHost(): Promise<boolean> {
    const verdict = this.verdict;
    const ttl =
      verdict?.failed === true ? FAILED_VERDICT_TTL_MS : VERDICT_TTL_MS;
    if (verdict !== null && this.now() - verdict.atMs < ttl) {
      return Promise.resolve(verdict.local);
    }
    this.judging ??= this.judge().finally(() => {
      this.judging = null;
    });
    return this.judging;
  }

  private async judge(): Promise<boolean> {
    let local = false;
    let totalBytes = 0;
    let cpus: number | null = null;
    let failed = false;
    try {
      const endpoint =
        !this.env.DOCKER_CONTEXT && this.env.DOCKER_HOST
          ? this.env.DOCKER_HOST
          : await this.dockerJson([
              'context',
              'inspect',
              '--format',
              '{{json .Endpoints.docker.Host}}',
            ]);
      const info = await this.dockerJson([
        'info',
        '--format',
        '{"cpus":{{json .NCPU}},"memory":{{json .MemTotal}},"kernel":{{json .KernelVersion}}}',
      ]);
      const daemonTotal =
        info !== null && typeof info === 'object' && 'memory' in info
          ? info.memory
          : null;
      const daemonKernel =
        info !== null && typeof info === 'object' && 'kernel' in info
          ? info.kernel
          : null;
      const own = parseMemory(await this.readFile('/proc/meminfo'));
      local =
        (endpoint === 'unix:///var/run/docker.sock' ||
          endpoint === 'unix:///run/docker.sock') &&
        daemonKernel === this.kernelRelease() &&
        typeof daemonTotal === 'number' &&
        own !== null &&
        own.totalBytes === daemonTotal;
      totalBytes = local && own !== null ? own.totalBytes : 0;
      const daemonCpus =
        info !== null && typeof info === 'object' && 'cpus' in info
          ? info.cpus
          : null;
      cpus =
        typeof daemonCpus === 'number' &&
        Number.isInteger(daemonCpus) &&
        daemonCpus > 0
          ? daemonCpus
          : null;
    } catch (error) {
      failed = true;
      // A host once found to be the Docker host stays it: a re-judge the
      // CLI could not answer (a busy daemon, a burst holding every CLI slot)
      // must not switch the memory guard off. It is asked again soon.
      const previous = this.verdict;
      if (previous?.local === true) {
        local = true;
        totalBytes = previous.totalBytes;
        cpus = previous.cpus;
      }
      console.warn(
        `[sandbox] cannot tell whether this host is the Docker host${local ? '; keeping the last verdict' : '; admission counts sessions only'} (asked again in ${FAILED_VERDICT_TTL_MS / 1000} s):`,
        error,
      );
    }
    this.verdict = { local, atMs: this.now(), totalBytes, cpus, failed };
    return local;
  }

  private async dockerJson(args: string[]): Promise<unknown> {
    const result = await this.docker(args);
    if (result.exitCode !== 0) {
      throw new Error(
        `docker ${args[0]} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
      );
    }
    return JSON.parse(result.stdout.trim());
  }
}
