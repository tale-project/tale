// The spawner's one host admission service. It judges how pressed the host is
// from the pressure sampler's readings (host-pressure.ts) — under the
// deployment's thresholds, or under a caller's stricter preset — and keeps the
// hysteresis of each set of thresholds it judges with; it remembers when the
// last session start was let in, and it holds the heavy-phase leases
// (heavy-leases.ts). Session admission asks it whether starts must be paced;
// the platform asks it, through GET /v1/admission, whether to start more work
// at all, and asks it for a lease before a heavy phase.
//
// Unknown pressure — a host whose /proc this process cannot trust (a remote
// Docker daemon, Kubernetes, Incus), a kernel without pressure stall
// information, readings that stopped — admits under the `default` preset, as
// session admission always has, and holds under `conservative`, which starts
// nothing it cannot judge. Leases are always judged conservatively.

import {
  DEFAULT_LEASE_MEMORY_BYTES,
  DEFAULT_PREDICTED_GROWTH_BYTES,
  HeavyLeases,
  type HeavyLease,
  type HeavyLeaseRequest,
} from './heavy-leases.ts';
import {
  belowDiskFloor,
  diskReserveBytes,
  type HostDisk,
  type HostDiskSource,
} from './host-disk.ts';
import {
  DEFAULT_CPU_PRESSURE_PERCENT,
  memoryReserveBytes,
  type HostMemory,
} from './host-memory.ts';
import {
  assessHostPressure,
  CONSERVATIVE_THRESHOLDS,
  dominantSignal,
  presetThresholds,
  PRESSURE_RETRY_MS,
  thresholdsKey,
  tightenThresholds,
  UNAVAILABLE_RETRY_MS,
  type AdmissionPresetName,
  type HostPressureReading,
  type PressureAssessment,
  type PressureReason,
  type PressureSignal,
  type PressureThresholds,
} from './host-pressure-assessment.ts';
import { NO_HOST_PRESSURE, type HostPressureSource } from './host-pressure.ts';
import type { AdmissionConfig, SpawnerConfig } from './types.ts';
import { notAhead } from './wall-clock.ts';

const GIB = 1024 ** 3;
const DEFAULT_HEAVY_LEASES_MAX = 2;
const DEFAULT_HEAVY_MIN_FREE_DISK_BYTES = 20 * GIB;

/** When to ask again after a hold for memory (running work frees it within
 * seconds), disk (freed by the sweep's upkeep, over minutes) or the heavy
 * limit (a phase ends). */
const MEMORY_RETRY_MS = 15_000;
const DISK_RETRY_MS = 60_000;
const LIMIT_RETRY_MS = 30_000;

export type AdmissionKind = 'start' | 'heavy';
export type AdmissionReason = PressureReason | 'memory' | 'disk' | 'limit';

/** The settings of a config that names none: the `default` preset at its
 * SANDBOX_CPU_PRESSURE_PERCENT, and the lease defaults. */
export function admissionConfigOf(
  cfg: Pick<SpawnerConfig, 'admission' | 'session'>,
): AdmissionConfig {
  return (
    cfg.admission ?? {
      preset: 'default',
      thresholds: presetThresholds(
        'default',
        cfg.session.cpuPressurePercent ?? DEFAULT_CPU_PRESSURE_PERCENT,
      ),
      heavyLeasesMax: DEFAULT_HEAVY_LEASES_MAX,
      heavyMinFreeDiskBytes: DEFAULT_HEAVY_MIN_FREE_DISK_BYTES,
    }
  );
}

export interface AdmissionEvidence {
  pressure: {
    first: HostPressureReading | null;
    last: HostPressureReading | null;
    /** How busy the host's CPUs were between the two readings, in percent:
     * how much of the CPU stall counts. */
    cpuBusy: number | null;
    score: number | null;
    pressured: boolean;
    thresholds: PressureThresholds;
  };
  memory: {
    availableBytes: number;
    reserveBytes: number;
    totalBytes: number;
  } | null;
  disk: { freeBytes: number; floorBytes: number; short: boolean } | null;
  sessions: { running: number; starting: number; limit: number };
  leases: { active: number; max: number };
}

/** The answer of GET /v1/admission. */
export interface AdmissionAnswer {
  verdict: 'admit' | 'hold';
  /** Why it holds; on an admit, null — or `stale` / `unavailable` where the
   * `default` preset admitted without a verdict on the pressure. */
  reason: AdmissionReason | null;
  retryAfterMs: number | null;
  /** The preset the answer was judged by: `conservative` where either the
   * deployment or the caller asked for it. */
  preset: AdmissionPresetName;
  /** When the spawner decided. */
  observedAtMs: number;
  evidence: AdmissionEvidence;
}

/** What session admission knows of the host beside its pressure: whether an
 * agent session's start would be refused for memory or disk now, and the
 * sessions it counts. */
export interface StartRoom {
  memoryShort: boolean;
  diskShort: boolean;
  sessions: { running: number; starting: number };
}

export type LeaseDecision =
  | { granted: true; lease: HeavyLease }
  | {
      granted: false;
      reason: AdmissionReason;
      retryAfterMs: number;
      evidence: AdmissionEvidence;
    };

export interface HostAdmissionDeps {
  pressure?: HostPressureSource;
  memory?: { latest(): HostMemory | null };
  disk?: Pick<HostDiskSource, 'latest' | 'byFilesystem'>;
  now?: () => number;
}

export class HostAdmission {
  readonly settings: AdmissionConfig;
  readonly leases: HeavyLeases;
  private readonly pressure: HostPressureSource;
  private readonly memory: { latest(): HostMemory | null } | undefined;
  private readonly disk:
    | Pick<HostDiskSource, 'latest' | 'byFilesystem'>
    | undefined;
  private readonly now: () => number;
  /** Whether the host is pressed, per distinct set of thresholds judged:
   * the deployment's, and the conservative tightening of them. */
  private readonly hysteresis = new Map<string, boolean>();
  private lastStart: number | null = null;

  constructor(
    /** Read on every decision: the session capacity is sized after boot. */
    private readonly cfg: Pick<SpawnerConfig, 'admission' | 'session'>,
    deps: HostAdmissionDeps = {},
  ) {
    this.settings = admissionConfigOf(cfg);
    this.pressure = deps.pressure ?? NO_HOST_PRESSURE;
    this.memory = deps.memory;
    this.disk = deps.disk;
    this.now = deps.now ?? Date.now;
    this.leases = new HeavyLeases(this.settings.heavyLeasesMax, this.now);
    // Both sets are followed from the first reading on, so their hysteresis
    // tracks the host, not the moments someone happened to ask.
    this.pressure.onReading?.(() => {
      this.assess();
      this.assess('conservative');
    });
  }

  /** The thresholds a caller's preset judges by: the deployment's, or —
   * for `conservative` — the stricter of the deployment's and the
   * conservative preset's, signal by signal. Never looser than the
   * deployment's. */
  effective(requested?: AdmissionPresetName): {
    preset: AdmissionPresetName;
    thresholds: PressureThresholds;
  } {
    if (requested !== 'conservative') {
      return {
        preset: this.settings.preset,
        thresholds: this.settings.thresholds,
      };
    }
    return {
      preset: 'conservative',
      thresholds: tightenThresholds(
        this.settings.thresholds,
        CONSERVATIVE_THRESHOLDS,
      ),
    };
  }

  /** Judge the host under a preset's effective thresholds, carrying their
   * hysteresis forward. With `lastStartAtMs`, a start not yet followed by a
   * fresh pair of readings is held for pacing. */
  assess(
    requested?: AdmissionPresetName,
    lastStartAtMs: number | null = null,
  ): PressureAssessment {
    const { thresholds } = this.effective(requested);
    const key = thresholdsKey(thresholds);
    const prior = this.hysteresis.get(key) ?? false;
    const assessment = assessHostPressure({
      readings: this.readings(),
      thresholds,
      pressured: prior,
      now: this.now(),
      lastStartAtMs,
    });
    if (assessment.score !== null) {
      this.hysteresis.set(key, assessment.pressured);
      if (
        assessment.pressured !== prior &&
        key === thresholdsKey(this.settings.thresholds)
      ) {
        this.sayPressure(assessment);
      }
    }
    return assessment;
  }

  /** Session admission's question: is the host pressed under the
   * deployment's thresholds, and by what? Unknown pressure is no pressure
   * here: session admission has always let work in when it could not tell. */
  startPressure(): { pressured: boolean; signal: PressureSignal | null } {
    const assessment = this.assess();
    return assessment.reason === 'pressure'
      ? { pressured: true, signal: dominantSignal(assessment) }
      : { pressured: false, signal: null };
  }

  /** A session start (a create, or an idle session's activation) was let in. */
  noteStart(atMs: number = this.now()): void {
    this.lastStart = Math.max(this.lastStartAtMs() ?? atMs, atMs);
  }

  /** The last start, never ahead of the clock: one it stepped back past
   * restarts at now, and is kept there, so it paces until a fresh pair of
   * readings follows it rather than until the clock has made up the step. */
  lastStartAtMs(): number | null {
    if (this.lastStart !== null) {
      this.lastStart = notAhead(this.lastStart, this.now());
    }
    return this.lastStart;
  }

  /** GET /v1/admission. `start` asks whether to start more work: the
   * existing memory and disk gates, then the pressure under the asked
   * preset, a start not yet followed by a fresh pair of readings held for
   * pacing. `heavy` asks what a lease of the default size would be told now,
   * without taking one. */
  answer(
    kind: AdmissionKind,
    requested: AdmissionPresetName | undefined,
    room: StartRoom,
  ): AdmissionAnswer {
    if (kind === 'heavy') {
      const assessment = this.assess('conservative');
      const refusal = this.heavyRefusal(assessment, {
        predictedGrowthBytes: DEFAULT_PREDICTED_GROWTH_BYTES,
        memoryBytes: DEFAULT_LEASE_MEMORY_BYTES,
      });
      return {
        verdict: refusal === null ? 'admit' : 'hold',
        reason: refusal?.reason ?? null,
        retryAfterMs: refusal?.retryAfterMs ?? null,
        preset: 'conservative',
        observedAtMs: this.now(),
        evidence: this.evidence(assessment, 'conservative', room.sessions),
      };
    }
    const { preset } = this.effective(requested);
    const assessment = this.assess(requested, this.lastStartAtMs());
    const answer = (
      verdict: 'admit' | 'hold',
      reason: AdmissionReason | null,
      retryAfterMs: number | null,
    ): AdmissionAnswer => ({
      verdict,
      reason,
      retryAfterMs,
      preset,
      observedAtMs: this.now(),
      evidence: this.evidence(assessment, requested, room.sessions),
    });
    if (room.diskShort) return answer('hold', 'disk', DISK_RETRY_MS);
    if (room.memoryShort) return answer('hold', 'memory', MEMORY_RETRY_MS);
    const reason = assessment.reason;
    if (
      reason === 'pressure' ||
      reason === 'pacing' ||
      (reason !== null && preset === 'conservative')
    ) {
      return answer(
        'hold',
        reason,
        assessment.retryAfterMs ?? PRESSURE_RETRY_MS,
      );
    }
    return answer('admit', reason, null);
  }

  /** POST /v1/sessions/:id/leases, once the session is known to be live:
   * grant the lease, or say why not. Synchronous, so no other lease is
   * decided between the check and the grant. */
  acquireLease(
    sessionId: string,
    request: HeavyLeaseRequest,
    sessions: StartRoom['sessions'],
  ): LeaseDecision {
    const assessment = this.assess('conservative');
    const refusal = this.heavyRefusal(assessment, request);
    if (refusal === null) {
      return { granted: true, lease: this.leases.grant(sessionId, request) };
    }
    return {
      granted: false,
      ...refusal,
      evidence: this.evidence(assessment, 'conservative', sessions),
    };
  }

  /** Why a heavy phase of this size may not start now, or null: the host
   * pressed (or not judged) under conservative thresholds; the most heavy
   * phases already running; a watched filesystem that would keep less than
   * its floor (at least SANDBOX_HEAVY_MIN_FREE_DISK) once every running
   * phase and this one wrote what they announced; memory that would keep
   * less than the reserve beside what they announced to hold. A disk or
   * memory that cannot be read refuses: a heavy phase is never let in
   * blind. */
  private heavyRefusal(
    assessment: PressureAssessment,
    request: Pick<HeavyLeaseRequest, 'predictedGrowthBytes' | 'memoryBytes'>,
  ): { reason: AdmissionReason; retryAfterMs: number } | null {
    if (assessment.reason !== null) {
      return {
        reason: assessment.reason,
        retryAfterMs: assessment.retryAfterMs ?? PRESSURE_RETRY_MS,
      };
    }
    const outstanding = this.leases.outstanding();
    if (outstanding.count >= this.settings.heavyLeasesMax) {
      return { reason: 'limit', retryAfterMs: LIMIT_RETRY_MS };
    }
    const disks = this.watchedDisks();
    if (disks === null) {
      return { reason: 'unavailable', retryAfterMs: UNAVAILABLE_RETRY_MS };
    }
    for (const disk of disks) {
      const required = Math.max(
        diskReserveBytes(disk.totalBytes, this.cfg.session.minFreeDiskBytes),
        this.settings.heavyMinFreeDiskBytes,
      );
      if (
        disk.availableBytes -
          outstanding.growthBytes -
          request.predictedGrowthBytes <
        required
      ) {
        return { reason: 'disk', retryAfterMs: DISK_RETRY_MS };
      }
    }
    const memory = this.readMemory();
    if (memory === null) {
      return { reason: 'unavailable', retryAfterMs: UNAVAILABLE_RETRY_MS };
    }
    const reserve = memoryReserveBytes(
      memory.totalBytes,
      this.cfg.session.minFreeMemoryBytes,
    );
    if (
      memory.availableBytes - outstanding.memoryBytes - request.memoryBytes <
      reserve
    ) {
      return { reason: 'memory', retryAfterMs: MEMORY_RETRY_MS };
    }
    return null;
  }

  private evidence(
    assessment: PressureAssessment,
    requested: AdmissionPresetName | undefined,
    sessions: StartRoom['sessions'],
  ): AdmissionEvidence {
    const memory = this.readMemory();
    const disk = this.readDisk();
    const { minFreeMemoryBytes, minFreeDiskBytes } = this.cfg.session;
    return {
      pressure: {
        first: assessment.evidence.first,
        last: assessment.evidence.last,
        cpuBusy: assessment.evidence.cpuBusy,
        score: assessment.score,
        pressured: assessment.pressured,
        thresholds: this.effective(requested).thresholds,
      },
      memory:
        memory === null
          ? null
          : {
              availableBytes: memory.availableBytes,
              reserveBytes: memoryReserveBytes(
                memory.totalBytes,
                minFreeMemoryBytes,
              ),
              totalBytes: memory.totalBytes,
            },
      disk:
        disk === null
          ? null
          : {
              freeBytes: disk.availableBytes,
              floorBytes: diskReserveBytes(disk.totalBytes, minFreeDiskBytes),
              short: belowDiskFloor(disk, minFreeDiskBytes),
            },
      sessions: { ...sessions, limit: this.cfg.session.maxSessions },
      leases: this.leases.summary(),
    };
  }

  /** The filesystems a heavy phase writes to, as last read: the
   * workspaces', and Docker's data root where it is watched apart. Null
   * while the workspaces' cannot be read, or while admission holds a
   * configured Docker data root it cannot verify. */
  private watchedDisks(): HostDisk[] | null {
    if (this.disk === undefined) return null;
    try {
      const lowest = this.disk.latest();
      if (lowest === null || lowest.unavailable === true) return null;
      const apart = this.disk.byFilesystem?.();
      if (apart === undefined) return [lowest];
      const { workspace, dockerData } = apart;
      if (workspace === null || workspace.unavailable === true) return null;
      return dockerData === null ||
        dockerData === undefined ||
        dockerData.unavailable === true
        ? [workspace]
        : [workspace, dockerData];
    } catch (error) {
      console.warn('[sandbox] session disk unreadable:', error);
      return null;
    }
  }

  private readMemory(): HostMemory | null {
    try {
      return this.memory?.latest() ?? null;
    } catch (error) {
      console.warn('[sandbox] host memory unreadable:', error);
      return null;
    }
  }

  private readDisk(): HostDisk | null {
    try {
      return this.disk?.latest() ?? null;
    } catch (error) {
      console.warn('[sandbox] session disk unreadable:', error);
      return null;
    }
  }

  private readings(): readonly HostPressureReading[] {
    try {
      return this.pressure.readings();
    } catch (error) {
      console.warn('[sandbox] host pressure readings unreadable:', error);
      return [];
    }
  }

  /** Log the deployment's thresholds being crossed, each way, once. */
  private sayPressure(assessment: PressureAssessment): void {
    const signal = dominantSignal(assessment);
    const evidence =
      signal === null ? null : assessment.evidence.signals[signal];
    const { cpuBusy } = assessment.evidence;
    const busy =
      signal === 'cpu' && cpuBusy !== null
        ? `, its CPUs ${Math.round(cpuBusy)}% busy`
        : '';
    const detail =
      evidence === null ||
      evidence.ratio === null ||
      evidence.threshold === null
        ? ''
        : ` (${signal} at ${Math.round(evidence.ratio * 100)}% of its ${evidence.threshold} threshold${busy})`;
    if (assessment.pressured) {
      console.warn(
        `[sandbox] the host is under pressure${detail}: sessions start one at a time until it eases (SANDBOX_ADMISSION_PRESET)`,
      );
    } else {
      console.log(`[sandbox] the host's pressure eased${detail}`);
    }
  }
}
