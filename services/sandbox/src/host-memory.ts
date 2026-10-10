// What the Docker host has left in memory, for admission and capacity sizing.
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
// The same reading carries the host's CPU pressure (the kernel's pressure
// stall information): while runnable tasks keep waiting for a CPU, admission
// lets new work start one at a time instead of adding to the queue.

import { release } from 'node:os';

import { parseMemory, parsePressureSomeAvg10 } from './proc-stats.ts';
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
/** The CPU pressure (PSI `some avg10`, in percent) from which admission lets
 * sessions start one at a time, unless SANDBOX_CPU_PRESSURE_PERCENT says
 * otherwise. */
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
  /** Read the host's CPU pressure beside its memory (off where admission
   * ignores it: SANDBOX_CPU_PRESSURE_PERCENT=0). */
  cpuPressure?: boolean;
}

export class HostMemoryProbe {
  private readonly docker: (args: string[]) => Promise<RunDockerResult>;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly kernelRelease: () => string;
  private readonly now: () => number;
  private readonly env: Record<string, string | undefined>;
  private readonly readsCpuPressure: boolean;
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
    cpuPressure: number | null;
  } | null = null;
  private cpuPressureWarned = false;
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
    this.readsCpuPressure = deps.cpuPressure ?? true;
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

  /** The Docker host's CPU pressure from the last reading: the share of the
   * last ten seconds, in percent, in which some runnable task waited for a
   * CPU (`some avg10` of /proc/pressure/cpu). Null where this process cannot
   * see the Docker host's /proc, or its kernel keeps no pressure stall
   * information. */
  cpuPressure(): number | null {
    return this.reading?.cpuPressure ?? null;
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
    let cpuPressure: number | null = null;
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
      if (this.readsCpuPressure) cpuPressure = await this.readCpuPressure();
    }
    // A slower read that started earlier never replaces a newer reading.
    if (this.reading === null || this.reading.atMs <= now) {
      this.reading = { atMs: now, memory, cpuPressure };
    }
    return memory;
  }

  /** The host's CPU pressure, or null where its kernel keeps none (built
   * without it, or booted with `psi=0`): admission then ignores CPU load,
   * which is said once. */
  private async readCpuPressure(): Promise<number | null> {
    try {
      const percent = parsePressureSomeAvg10(
        await this.readFile('/proc/pressure/cpu'),
      );
      if (percent === null) {
        throw new Error('/proc/pressure/cpu has no "some avg10" reading');
      }
      return percent;
    } catch (error) {
      if (!this.cpuPressureWarned) {
        this.cpuPressureWarned = true;
        console.warn(
          '[sandbox] the host keeps no CPU pressure reading; admission ignores CPU load:',
          error,
        );
      }
      return null;
    }
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
