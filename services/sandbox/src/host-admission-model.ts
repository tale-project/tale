// Admission arithmetic shared by the exclusive host authority's native
// writers. This is a decision model, not evidence that the caller owns that
// authority: the durable journal/owner fence must supply the snapshot.
import { memoryReserveBytes } from './host-memory.ts';

const GIB = 1024 ** 3;
export const HOST_PHASE_LIMIT = 2;

export interface HostAdmissionIdentity {
  daemonId: string;
  hostBootId: string;
  filesystemId: string;
  authorityGeneration: string;
}

export interface HostAdmissionHold {
  id: string;
  kind: 'create' | 'activate' | 'phase';
  memoryBytes: number;
  diskBytes: number;
}

export interface HostAdmissionReading {
  identity: HostAdmissionIdentity;
  observedAt: number;
  onlineCpus: number;
  load1: number;
  cpuPsi: number;
  memoryPsi: number;
  ioPsi: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  diskAvailableBytes: number;
}

export interface HostAdmissionSnapshot {
  identity: HostAdmissionIdentity;
  epoch: number;
  lastStartedAt: number;
  pressured: boolean;
  holds: readonly HostAdmissionHold[];
  readings: readonly [HostAdmissionReading, HostAdmissionReading];
}

export interface HostAdmissionRequest {
  hold: HostAdmissionHold;
  expectedEpoch: number;
  /** Trusted operator/native reserve, never a worker supplied value. */
  nativeMemoryReserveBytes?: number;
  nativeDiskReserveBytes: number;
}

export type HostAdmissionDecision =
  | { admitted: true; pressured: false }
  | {
      admitted: false;
      reason:
        | 'unavailable'
        | 'stale'
        | 'pressure'
        | 'duplicate'
        | 'phase_limit'
        | 'memory'
        | 'disk';
      pressured: boolean;
    };

function integer(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function identityValid(value: HostAdmissionIdentity): boolean {
  return (
    Object.values(value).length === 4 &&
    Object.values(value).every(
      (part) =>
        typeof part === 'string' && /^[a-zA-Z0-9:._-]{1,128}$/.test(part),
    )
  );
}

function sameIdentity(
  left: HostAdmissionIdentity,
  right: HostAdmissionIdentity,
): boolean {
  return (
    left.daemonId === right.daemonId &&
    left.hostBootId === right.hostBootId &&
    left.filesystemId === right.filesystemId &&
    left.authorityGeneration === right.authorityGeneration
  );
}

function validHold(hold: HostAdmissionHold): boolean {
  return (
    /^[a-zA-Z0-9_-]{1,128}$/.test(hold.id) &&
    ['create', 'activate', 'phase'].includes(hold.kind) &&
    integer(hold.memoryBytes) &&
    hold.memoryBytes > 0 &&
    integer(hold.diskBytes)
  );
}

function validReading(reading: HostAdmissionReading): boolean {
  return (
    identityValid(reading.identity) &&
    integer(reading.observedAt) &&
    Number.isSafeInteger(reading.onlineCpus) &&
    reading.onlineCpus > 0 &&
    Number.isFinite(reading.load1) &&
    reading.load1 >= 0 &&
    [reading.cpuPsi, reading.memoryPsi, reading.ioPsi].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    ) &&
    integer(reading.memoryTotalBytes) &&
    reading.memoryTotalBytes > 0 &&
    integer(reading.memoryAvailableBytes) &&
    reading.memoryAvailableBytes <= reading.memoryTotalBytes &&
    integer(reading.diskAvailableBytes)
  );
}

/** No count/growth is inferred from a label or caller boolean. Unsettled
 * creates, activations and phases must all be supplied by the same native
 * journal. A phase hold has no time-based decay in this decision. */
export function assessHostAdmission(
  snapshot: HostAdmissionSnapshot,
  request: HostAdmissionRequest,
  now: number,
): HostAdmissionDecision {
  const refused = (
    reason: Extract<HostAdmissionDecision, { admitted: false }>['reason'],
    pressured = snapshot.pressured,
  ): HostAdmissionDecision => ({ admitted: false, reason, pressured });
  const [first, last] = snapshot.readings;
  if (
    !integer(now) ||
    !integer(snapshot.epoch) ||
    !integer(snapshot.lastStartedAt) ||
    !identityValid(snapshot.identity) ||
    !validReading(first) ||
    !validReading(last) ||
    !sameIdentity(snapshot.identity, first.identity) ||
    !sameIdentity(snapshot.identity, last.identity) ||
    first.onlineCpus !== last.onlineCpus ||
    first.memoryTotalBytes !== last.memoryTotalBytes ||
    !validHold(request.hold) ||
    !snapshot.holds.every(validHold) ||
    new Set(snapshot.holds.map((hold) => hold.id)).size !==
      snapshot.holds.length ||
    !integer(request.nativeDiskReserveBytes) ||
    (request.nativeMemoryReserveBytes !== undefined &&
      !integer(request.nativeMemoryReserveBytes))
  )
    return refused('unavailable');
  if (
    request.expectedEpoch !== snapshot.epoch ||
    first.observedAt <= snapshot.lastStartedAt ||
    last.observedAt - first.observedAt < 10_000 ||
    last.observedAt - first.observedAt > 60_000 ||
    now < last.observedAt ||
    now - last.observedAt > 30_000
  )
    return refused('stale');
  const pressure = Math.max(
    ...snapshot.readings.flatMap((reading) => [
      reading.load1 / reading.onlineCpus,
      reading.cpuPsi / 20,
      reading.memoryPsi,
      reading.ioPsi / 10,
    ]),
  );
  if (pressure >= 1 || (snapshot.pressured && pressure >= 0.5))
    return refused('pressure', true);
  if (snapshot.holds.some((hold) => hold.id === request.hold.id))
    return refused('duplicate', false);
  if (
    request.hold.kind === 'phase' &&
    snapshot.holds.filter((hold) => hold.kind === 'phase').length >=
      HOST_PHASE_LIMIT
  )
    return refused('phase_limit', false);
  const memory = snapshot.holds.reduce(
    (sum, hold) => sum + hold.memoryBytes,
    request.hold.memoryBytes,
  );
  const disk = snapshot.holds.reduce(
    (sum, hold) => sum + hold.diskBytes,
    request.hold.diskBytes,
  );
  if (!integer(memory) || !integer(disk)) return refused('unavailable');
  // The smaller observation is conservative when pressure or writes are
  // still growing between samples. Reservations are added exactly once.
  const availableMemory = Math.min(
    first.memoryAvailableBytes,
    last.memoryAvailableBytes,
  );
  const availableDisk = Math.min(
    first.diskAvailableBytes,
    last.diskAvailableBytes,
  );
  if (
    availableMemory - memory <
    memoryReserveBytes(last.memoryTotalBytes, request.nativeMemoryReserveBytes)
  )
    return refused('memory', false);
  if (availableDisk - disk < Math.max(20 * GIB, request.nativeDiskReserveBytes))
    return refused('disk', false);
  return { admitted: true, pressured: false };
}
