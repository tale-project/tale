// The host's pressure, sampled every five seconds into a ring of the last two
// minutes: the one-minute load average and the CPUs online, and the kernel's
// pressure stall shares of CPU, memory and I/O (`some avg10` of
// /proc/pressure/{cpu,memory,io}). Only where /proc describes the Docker host
// — the memory probe's judgement: the standard local socket, the same kernel
// and total as the daemon reports — since anywhere else these files describe
// another machine. Elsewhere the ring stays empty and admission reads the
// host's pressure as unavailable.
//
// This is the one reader of /proc/pressure/cpu: session admission's pressure
// gate and the admission answer the platform asks for both decide from this
// ring (host-admission.ts), so the two can never disagree about a reading.

import type { HostPressureReading } from './host-pressure-assessment.ts';
import {
  parseLoadAverage,
  parseOnlineCpus,
  parsePressureSomeAvg10,
} from './proc-stats.ts';

/** How often the host is read. The kernel's averages span ten seconds, so a
 * verdict always has two readings that far apart within a sample of it. */
export const PRESSURE_SAMPLE_MS = 5_000;
/** How much history the ring keeps. */
export const PRESSURE_RING_MS = 2 * 60_000;
/** The most readings the ring holds, whatever the clock does. */
const RING_CAP = 64;

/** Where admission reads the host's pressure from. */
export interface HostPressureSource {
  /** The readings of the last two minutes, oldest first; none where the
   * host's /proc cannot be trusted to describe it. */
  readings(): readonly HostPressureReading[];
  /** Call `listener` after each new reading; returns its removal. */
  onReading?(listener: () => void): () => void;
}

export const NO_HOST_PRESSURE: HostPressureSource = { readings: () => [] };

type SignalName = 'load' | 'cpus' | 'cpu' | 'memory' | 'io';

const SIGNAL_FILES: Record<SignalName, { path: string; what: string }> = {
  load: { path: '/proc/loadavg', what: 'load average' },
  cpus: { path: '/sys/devices/system/cpu/online', what: 'online CPUs' },
  cpu: { path: '/proc/pressure/cpu', what: 'CPU pressure' },
  memory: { path: '/proc/pressure/memory', what: 'memory pressure' },
  io: { path: '/proc/pressure/io', what: 'I/O pressure' },
};

export interface HostPressureSamplerDeps {
  /** Whether this process's /proc describes the Docker host. */
  isLocal: () => Promise<boolean>;
  readFile?: (path: string) => Promise<string>;
  now?: () => number;
}

export class HostPressureSampler implements HostPressureSource {
  private readonly isLocal: () => Promise<boolean>;
  private readonly readFile: (path: string) => Promise<string>;
  private readonly now: () => number;
  private ring: HostPressureReading[] = [];
  private local: boolean | null = null;
  private sampling: Promise<void> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Signals whose file could not be read, each said once. */
  private readonly unreadable = new Set<SignalName>();

  constructor(deps: HostPressureSamplerDeps) {
    this.isLocal = deps.isLocal;
    this.readFile = deps.readFile ?? ((path) => Bun.file(path).text());
    this.now = deps.now ?? Date.now;
  }

  /** Read the host now and every {@link PRESSURE_SAMPLE_MS} from now on. */
  start(): void {
    if (this.ticker !== null) return;
    void this.sample();
    this.ticker = setInterval(() => {
      void this.sample();
    }, PRESSURE_SAMPLE_MS);
    this.ticker.unref();
  }

  stop(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  readings(): readonly HostPressureReading[] {
    const now = this.now();
    return this.ring.filter(
      (reading) => now - reading.atMs <= PRESSURE_RING_MS,
    );
  }

  /** Whether the host was found to be the Docker host: null until the
   * first sample asked. */
  describesHost(): boolean | null {
    return this.local;
  }

  onReading(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Take one reading; a sample still under way is joined, not repeated.
   * Never rejects. */
  sample(): Promise<void> {
    this.sampling ??= this.sampleNow()
      .catch((error: unknown) => {
        console.warn('[sandbox] sampling the host pressure failed:', error);
      })
      .finally(() => {
        this.sampling = null;
      });
    return this.sampling;
  }

  private async sampleNow(): Promise<void> {
    const atMs = this.now();
    if (!(await this.isLocal())) {
      // Readings taken while the host still read as the Docker host no
      // longer say anything about it.
      this.local = false;
      this.ring = [];
      return;
    }
    this.local = true;
    const [load1, cpus, cpuPsi, memoryPsi, ioPsi] = await Promise.all([
      this.readSignal('load', parseLoadAverage),
      this.readSignal('cpus', parseOnlineCpus),
      this.readSignal('cpu', parsePressureSomeAvg10),
      this.readSignal('memory', parsePressureSomeAvg10),
      this.readSignal('io', parsePressureSomeAvg10),
    ]);
    // A clock that went back leaves no reading stamped after this one.
    this.ring = [
      ...this.ring.filter(
        (reading) =>
          reading.atMs < atMs && atMs - reading.atMs <= PRESSURE_RING_MS,
      ),
      { atMs, load1, cpus, cpuPsi, memoryPsi, ioPsi },
    ].slice(-RING_CAP);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[sandbox] a host pressure listener failed:', error);
      }
    }
  }

  /** One signal, or null when its file cannot be read or holds no reading
   * (a kernel built without pressure stall information, or booted with
   * `psi=0`): unknown, never 0. Said once per signal. */
  private async readSignal(
    name: SignalName,
    parse: (text: string) => number | null,
  ): Promise<number | null> {
    const { path, what } = SIGNAL_FILES[name];
    try {
      const value = parse(await this.readFile(path));
      if (value === null) throw new Error(`${path} holds no reading`);
      return value;
    } catch (error) {
      if (!this.unreadable.has(name)) {
        this.unreadable.add(name);
        console.warn(
          `[sandbox] the host gives no ${what} reading; admission takes it as unknown:`,
          error,
        );
      }
      return null;
    }
  }
}
