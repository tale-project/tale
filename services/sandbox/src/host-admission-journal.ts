// Durable native admission intents. This store is deliberately not wired to
// a route: its caller must first own the lifetime host fence. A process-local
// queue serializes that owner's writers; it is NOT a cross-process lock.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { writeDurableSnapshot } from './durable-snapshot.ts';
import {
  assessHostAdmission,
  type HostAdmissionDecision,
  type HostAdmissionHold,
  type HostAdmissionIdentity,
  type HostAdmissionReading,
  type HostAdmissionRequest,
} from './host-admission-model.ts';

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 4096;
const ORDINARY_TOMBSTONES = 128;
const HASH = /^[a-f0-9]{64}$/;
const ORDINARY_UUID = /^74616c65-6164-8000-8([0-9a-f]{3})-([0-9a-f]{12})$/;

/** Custom UUIDv8 namespace, disjoint from legacy random UUIDv4 attempts.
 * The durable epoch is consumed by reserve before dispatch; no removed ID
 * can be issued again. Keep the backend's existing UUID label grammar. */
export function ordinaryAdmissionId(epoch: number): string {
  if (!integer(epoch) || epoch >= Number.MAX_SAFE_INTEGER)
    throw new Error('Host admission epoch exhausted');
  const value = epoch.toString(16).padStart(15, '0');
  return `74616c65-6164-8000-8${value.slice(0, 3)}-${value.slice(3)}`;
}

export interface NativeAdmissionContainer {
  id: string;
  name: string;
  sessionId?: string;
  createAttemptId?: string;
  createdAtMs?: number;
  running: boolean;
}

export interface HostAdmissionIntent extends HostAdmissionHold {
  requestHash: string;
  containerName: string;
  state: 'reserved' | 'dispatching' | 'active' | 'released';
  containerId: string | null;
  startBefore: number;
  /** Only acknowledged ordinary growth can age into observed steady usage. */
  startedAt: number | null;
  pendingUse: string | null;
}

interface Journal {
  version: 2;
  identity: HostAdmissionIdentity;
  epoch: number;
  lastStartedAt: number;
  lastObservedAt: number;
  pressured: boolean;
  intents: HostAdmissionIntent[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join(',') === expected.sort().join(',');
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseIntent(value: unknown): HostAdmissionIntent {
  const row = record(value);
  if (
    !row ||
    !keys(row, [
      'id',
      'kind',
      'memoryBytes',
      'diskBytes',
      'requestHash',
      'containerName',
      'state',
      'containerId',
      'startBefore',
      'startedAt',
      'pendingUse',
    ]) ||
    typeof row.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id) ||
    (row.kind !== 'create' &&
      row.kind !== 'activate' &&
      row.kind !== 'phase') ||
    !integer(row.memoryBytes) ||
    row.memoryBytes === 0 ||
    !integer(row.diskBytes) ||
    typeof row.requestHash !== 'string' ||
    !HASH.test(row.requestHash) ||
    typeof row.containerName !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(row.containerName) ||
    (row.state !== 'reserved' &&
      row.state !== 'dispatching' &&
      row.state !== 'active' &&
      row.state !== 'released') ||
    !integer(row.startBefore) ||
    (row.startedAt !== null && !integer(row.startedAt)) ||
    (row.pendingUse !== null &&
      (typeof row.pendingUse !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(row.pendingUse))) ||
    (row.pendingUse !== null &&
      (row.kind === 'phase' || row.state !== 'active')) ||
    (row.containerId !== null &&
      (typeof row.containerId !== 'string' || !HASH.test(row.containerId))) ||
    (row.state === 'active' && row.containerId === null) ||
    ((row.state === 'reserved' || row.state === 'dispatching') &&
      row.startedAt !== null) ||
    ((row.state === 'reserved' || row.state === 'dispatching') &&
      row.containerId !== null)
  )
    throw new Error('Invalid host admission intent');
  return {
    id: row.id,
    kind: row.kind,
    memoryBytes: row.memoryBytes,
    diskBytes: row.diskBytes,
    requestHash: row.requestHash,
    containerName: row.containerName,
    state: row.state,
    containerId: row.containerId,
    startBefore: row.startBefore,
    startedAt: row.startedAt,
    pendingUse: row.pendingUse,
  };
}

function sameIdentity(left: unknown, right: HostAdmissionIdentity): boolean {
  const row = record(left);
  return (
    row !== null &&
    keys(row, [
      'daemonId',
      'hostBootId',
      'filesystemId',
      'authorityGeneration',
    ]) &&
    Object.entries(right).length === 4 &&
    Object.entries(right).every(
      ([key, value]) =>
        /^[a-zA-Z0-9:._-]{1,128}$/.test(value) && row[key] === value,
    )
  );
}

function parseJournal(raw: string, identity: HostAdmissionIdentity): Journal {
  const row = record(JSON.parse(raw));
  if (
    !row ||
    !keys(row, [
      'version',
      'identity',
      'epoch',
      'lastStartedAt',
      'lastObservedAt',
      'pressured',
      'intents',
    ]) ||
    row.version !== 2 ||
    !sameIdentity(row.identity, identity) ||
    !integer(row.epoch) ||
    !integer(row.lastStartedAt) ||
    !integer(row.lastObservedAt) ||
    row.lastStartedAt > row.lastObservedAt ||
    typeof row.pressured !== 'boolean' ||
    !Array.isArray(row.intents) ||
    row.intents.length > MAX_RECORDS
  )
    throw new Error('Host admission journal requires reconciliation');
  const intents = row.intents.map(parseIntent);
  const epoch = row.epoch;
  if (
    new Set(intents.map((intent) => intent.id)).size !== intents.length ||
    new Set(
      intents
        .filter((intent) => intent.state !== 'released')
        .map((intent) => intent.containerName),
    ).size !== intents.filter((intent) => intent.state !== 'released').length ||
    intents.some((intent) => {
      const issued = ORDINARY_UUID.exec(intent.id);
      if (!issued || intent.kind === 'phase') return false;
      const issuedAt = Number.parseInt(`${issued[1]}${issued[2]}`, 16);
      return !Number.isSafeInteger(issuedAt) || issuedAt >= epoch;
    })
  )
    throw new Error('Duplicate host admission identity');
  return {
    version: 2,
    identity: { ...identity },
    epoch: row.epoch,
    lastStartedAt: row.lastStartedAt,
    lastObservedAt: row.lastObservedAt,
    pressured: row.pressured,
    intents,
  };
}

export type HostReservationResult =
  | {
      admitted: true;
      replay: boolean;
      intent: HostAdmissionIntent;
      epoch: number;
    }
  | Extract<HostAdmissionDecision, { admitted: false }>;

export class HostAdmissionJournal {
  private state: Journal | null = null;
  private writing: Promise<void> = Promise.resolve();
  private clockFloor = 0;

  constructor(
    private readonly file: string,
    private readonly identity: HostAdmissionIdentity,
    // Native authority callback, never a wire boolean. It must throw on a
    // missing/changed owner, including after a slow disk or daemon call.
    private readonly assertOwner: () => Promise<void>,
    private readonly clock: () => number = Date.now,
    private readonly writeSnapshot: typeof writeDurableSnapshot = writeDurableSnapshot,
  ) {}

  async load(
    assertPriorRetired?: (identity: HostAdmissionIdentity) => Promise<void>,
  ): Promise<void> {
    if (this.state !== null)
      throw new Error('Host admission journal already loaded');
    await this.assertOwner();
    let next: Journal;
    try {
      const handle = await open(
        this.file,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES)
          throw new Error('Invalid host admission journal size');
        const bytes = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < bytes.length) {
          const chunk = await handle.read(bytes, length, bytes.length - length);
          if (chunk.bytesRead === 0) break;
          length += chunk.bytesRead;
        }
        if (length !== stat.size)
          throw new Error('Host admission journal changed during read');
        const raw = new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(0, length),
        );
        const previous = record(JSON.parse(raw))?.identity;
        if (!sameIdentity(previous, this.identity)) {
          const identity = record(previous);
          if (
            !identity ||
            typeof identity.daemonId !== 'string' ||
            typeof identity.hostBootId !== 'string' ||
            typeof identity.filesystemId !== 'string' ||
            typeof identity.authorityGeneration !== 'string'
          )
            throw new Error('Host admission journal requires reconciliation');
          const prior = {
            daemonId: identity.daemonId,
            hostBootId: identity.hostBootId,
            filesystemId: identity.filesystemId,
            authorityGeneration: identity.authorityGeneration,
          };
          if (
            !sameIdentity(identity, prior) ||
            prior.daemonId !== this.identity.daemonId ||
            !assertPriorRetired
          )
            throw new Error('Host admission journal requires reconciliation');
          next = parseJournal(raw, prior);
          // The native owner proves termination. A new generation preserves
          // every hold, including never-acknowledged create/activation calls.
          // It cannot infer completion from elapsed time or healthy telemetry.
          await assertPriorRetired(prior);
          await this.assertOwner();
          next.identity = { ...this.identity };
          next.epoch++;
          next.lastStartedAt = this.observeClock(next.lastObservedAt);
          next.lastObservedAt = next.lastStartedAt;
          if (!integer(next.lastStartedAt) || !integer(next.epoch))
            throw new Error('Invalid host admission recovery clock');
          await this.persist(next);
        } else next = parseJournal(raw, this.identity);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        !(
          error !== null &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      )
        throw error;
      if (!sameIdentity(this.identity, this.identity))
        throw new Error('Invalid host admission identity', { cause: error });
      next = {
        version: 2,
        identity: { ...this.identity },
        epoch: 0,
        lastStartedAt: 0,
        lastObservedAt: 0,
        pressured: false,
        intents: [],
      };
      await this.persist(next);
    }
    await this.assertOwner();
    this.state = next;
    this.clockFloor = Math.max(this.clockFloor, next.lastObservedAt);
  }

  snapshot(): Journal {
    if (!this.state) throw new Error('Host admission journal not loaded');
    return structuredClone(this.state);
  }

  reserve(
    request: HostAdmissionRequest,
    binding: { requestHash: string; containerName: string },
    readings: readonly [HostAdmissionReading, HostAdmissionReading],
  ): Promise<HostReservationResult> {
    const intent = parseIntent({
      ...request.hold,
      ...binding,
      state: 'reserved',
      containerId: null,
      startBefore: readings[1].observedAt + 30_000,
      startedAt: null,
      pendingUse: null,
    });
    return this.change((next, now) => {
      const previous = next.intents.find((row) => row.id === intent.id);
      if (previous) {
        if (
          previous.requestHash !== intent.requestHash ||
          previous.containerName !== intent.containerName ||
          previous.kind !== intent.kind ||
          previous.memoryBytes !== intent.memoryBytes ||
          previous.diskBytes !== intent.diskBytes
        )
          throw new Error('Host admission idempotency conflict');
        return {
          admitted: true,
          replay: true,
          intent: structuredClone(previous),
          epoch: next.epoch,
        };
      }
      if (
        intent.kind === 'phase'
          ? ORDINARY_UUID.test(intent.id)
          : intent.id !== ordinaryAdmissionId(next.epoch)
      )
        throw new Error('Host admission attempt was not freshly issued');
      this.compact(next, true);
      if (
        next.intents.length >= MAX_RECORDS ||
        next.intents.some(
          (row) =>
            row.state !== 'released' &&
            row.containerName === intent.containerName,
        )
      )
        throw new Error('Host admission journal requires reconciliation');
      const decision = assessHostAdmission(
        {
          ...next,
          holds: next.intents.filter((row) => row.state !== 'released'),
          readings,
        },
        request,
        now,
      );
      next.pressured = decision.pressured;
      if (!decision.admitted) return decision;
      next.intents.push(intent);
      next.epoch++;
      return {
        admitted: true,
        replay: false,
        intent: structuredClone(intent),
        epoch: next.epoch,
      };
    });
  }

  /** One complete native scan, one durable transition for every discovered
   * hold. An absent immutable CID cannot reappear; growth settlement needs
   * the exact running CID/name. Health never acknowledges uncertain use. */
  reconcileInventory(
    observe: () => Promise<readonly NativeAdmissionContainer[]>,
  ): Promise<readonly NativeAdmissionContainer[]> {
    return this.change(async (next, now) => {
      const rows = await observe();
      if (
        rows.some((row) => !HASH.test(row.id)) ||
        new Set(rows.map((row) => row.id)).size !== rows.length
      )
        throw new Error('Host admission container mismatch');
      const byId = new Map(rows.map((row) => [row.id, row]));
      const byAttempt = new Map(
        rows
          .filter((row) => row.createAttemptId !== undefined)
          .map((row) => [row.createAttemptId, row]),
      );
      let changed = false;
      for (const intent of next.intents) {
        if (intent.state === 'released') continue;
        if (intent.state === 'reserved') {
          // The sole coordinator cannot reconcile between its reserve and
          // dispatch. This state proves no launch was authorized.
          this.release(intent);
          changed = true;
        } else if (intent.state === 'dispatching') {
          const exact = byAttempt.get(intent.id);
          if (exact?.name === intent.containerName) {
            intent.state = 'active';
            intent.containerId = exact.id;
            intent.startedAt = null;
            changed = true;
          }
        } else if (intent.containerId !== null) {
          const exact = byId.get(intent.containerId);
          if (
            !exact ||
            (this.canSettle(intent, now) &&
              exact.running &&
              exact.name === intent.containerName)
          ) {
            this.release(intent);
            changed = true;
          }
        }
      }
      if (changed) next.epoch++;
      return rows;
    });
  }

  /** Commit BEFORE sending create/start. A replay returns false and must
   * never send a second launch. Lost acknowledgments remain occupied. */
  dispatch(id: string, requestHash: string): Promise<boolean> {
    return this.change((next, now) => {
      const intent = this.intent(next, id, requestHash);
      if (intent.state !== 'reserved') return false;
      if (now > intent.startBefore)
        throw new Error('Host admission start window expired');
      intent.state = 'dispatching';
      next.lastStartedAt = now;
      next.epoch++;
      return true;
    });
  }

  started(id: string, requestHash: string, containerId: string): Promise<void> {
    return this.change((next, now) => {
      const intent = this.intent(next, id, requestHash);
      if (
        !HASH.test(containerId) ||
        (intent.state !== 'dispatching' && intent.state !== 'active') ||
        (intent.containerId !== null && intent.containerId !== containerId)
      )
        throw new Error('Host admission container mismatch');
      if (
        intent.state === 'active' &&
        (intent.startedAt !== null || intent.pendingUse !== null)
      )
        return;
      intent.state = 'active';
      intent.containerId = containerId;
      intent.startedAt = now;
      next.lastStartedAt = now;
      next.epoch++;
    });
  }

  /** An activation reserves growth for an already-existing exact object;
   * it does not dispatch work. Only beginOrdinaryUse authorizes that RPC. */
  bindExistingActivation(
    id: string,
    requestHash: string,
    observeCurrent: () => Promise<string>,
  ): Promise<void> {
    return this.change(async (next) => {
      const intent = this.intent(next, id, requestHash);
      if (intent.kind !== 'activate' || intent.state !== 'reserved')
        throw new Error('Host admission activation mismatch');
      const containerId = await observeCurrent();
      if (!HASH.test(containerId))
        throw new Error('Host admission container mismatch');
      intent.state = 'active';
      intent.containerId = containerId;
      next.epoch++;
    });
  }

  /** Bind a lost create response only after native custody proves the exact
   * persisted attempt. This is discovery, not a startup/RPC acknowledgment:
   * ordinary growth cannot age away until a later use is acknowledged. */
  reconcileDispatched(
    id: string,
    requestHash: string,
    observeAttempt: (intent: HostAdmissionIntent) => Promise<string>,
  ): Promise<void> {
    return this.change(async (next) => {
      const intent = this.intent(next, id, requestHash);
      if (intent.state !== 'dispatching')
        throw new Error('Host admission is not an uncertain dispatch');
      const containerId = await observeAttempt(structuredClone(intent));
      if (!HASH.test(containerId))
        throw new Error('Host admission container mismatch');
      intent.state = 'active';
      intent.containerId = containerId;
      intent.startedAt = null;
      next.epoch++;
    });
  }

  /** The immediate create→acquire→exec chain already owns this container's
   * startup working set. Reuse it once, without creating a second hold. A
   * lost reply stays pending and never ages out as acknowledged growth. */
  beginOrdinaryUse(
    id: string,
    requestHash: string,
    containerId: string,
    useId: string,
    request: HostAdmissionRequest,
    readings: readonly [HostAdmissionReading, HostAdmissionReading],
  ): Promise<HostAdmissionDecision> {
    return this.change((next, now) => {
      const intent = this.intent(next, id, requestHash);
      if (
        intent.kind === 'phase' ||
        intent.state !== 'active' ||
        intent.containerId !== containerId ||
        intent.pendingUse !== null ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(useId) ||
        request.hold.id !== intent.id ||
        request.hold.kind !== intent.kind ||
        request.hold.memoryBytes !== intent.memoryBytes ||
        request.hold.diskBytes !== intent.diskBytes
      )
        throw new Error('Ordinary growth requires reconciliation');
      const decision = assessHostAdmission(
        {
          ...next,
          holds: next.intents.filter(
            (row) => row.id !== id && row.state !== 'released',
          ),
          readings,
        },
        request,
        now,
      );
      next.pressured = decision.pressured;
      if (!decision.admitted) return decision;
      const newGrowth = intent.startedAt === null;
      intent.pendingUse = useId;
      intent.startedAt = null;
      intent.startBefore = readings[1].observedAt + 30_000;
      // Acknowledged startup already reserves this full working set. Reusing
      // it changes RPC custody, not the host's aggregate growth. New idle
      // activation/discovered startup still advances the sampling boundary.
      if (newGrowth) next.lastStartedAt = now;
      next.epoch++;
      return decision;
    });
  }

  acknowledgeOrdinaryUse(
    id: string,
    requestHash: string,
    containerId: string,
    useId: string,
  ): Promise<void> {
    return this.change((next, now) => {
      const intent = this.intent(next, id, requestHash);
      if (
        intent.kind === 'phase' ||
        intent.state !== 'active' ||
        intent.containerId !== containerId ||
        intent.pendingUse !== useId
      )
        throw new Error('Ordinary growth acknowledgment mismatch');
      intent.pendingUse = null;
      intent.startedAt = now;
      next.epoch++;
    });
  }

  /** This releases an ordinary startup estimate, never a session or phase.
   * Require current exact-incarnation observation after the existing 90s
   * growth window. Unknown dispatches and pending uses have no age release. */
  settleOrdinaryGrowth(
    id: string,
    requestHash: string,
    containerId: string,
    observeCurrent: (id: string) => Promise<void>,
  ): Promise<boolean> {
    return this.change(async (next, now) => {
      const intent = this.intent(next, id, requestHash);
      if (
        intent.kind === 'phase' ||
        intent.state !== 'active' ||
        intent.containerId !== containerId
      )
        throw new Error('Ordinary growth container mismatch');
      if (!this.canSettle(intent, now)) return false;
      await observeCurrent(containerId);
      this.release(intent);
      next.epoch++;
      return true;
    });
  }

  /** Only a never-dispatched intent is locally cancellable. Native gone
   * proof for an actual CID is required after dispatch; uncertain launches
   * have no timeout-based release path. */
  cancelReserved(id: string, requestHash: string): Promise<void> {
    return this.change((next) => {
      const intent = this.intent(next, id, requestHash);
      if (intent.state !== 'reserved')
        throw new Error('Dispatched admission requires native reconciliation');
      this.release(intent);
      next.epoch++;
    });
  }

  releaseGone(
    id: string,
    requestHash: string,
    containerId: string,
    observeGone: (id: string) => Promise<void>,
  ): Promise<void> {
    return this.change(async (next) => {
      const intent = this.intent(next, id, requestHash);
      if (intent.state !== 'active' || intent.containerId !== containerId)
        throw new Error('Host admission container mismatch');
      await observeGone(containerId);
      this.release(intent);
      next.epoch++;
    });
  }

  private intent(
    next: Journal,
    id: string,
    requestHash: string,
  ): HostAdmissionIntent {
    const intent = next.intents.find((row) => row.id === id);
    if (!intent || intent.requestHash !== requestHash)
      throw new Error('Unknown host admission intent');
    return intent;
  }

  private canSettle(intent: HostAdmissionIntent, now: number): boolean {
    return (
      intent.kind !== 'phase' &&
      intent.state === 'active' &&
      intent.pendingUse === null &&
      intent.startedAt !== null &&
      now - intent.startedAt >= 90_000
    );
  }

  private release(intent: HostAdmissionIntent): void {
    intent.state = 'released';
    intent.pendingUse = null;
    intent.startedAt = null;
  }

  private compact(next: Journal, reserveSlot = false): void {
    const released = next.intents.filter(
      (intent) =>
        intent.kind !== 'phase' &&
        intent.state === 'released' &&
        ORDINARY_UUID.test(intent.id),
    );
    const keep = Math.max(
      0,
      Math.min(
        ORDINARY_TOMBSTONES,
        MAX_RECORDS -
          (next.intents.length - released.length) -
          Number(reserveSlot),
      ),
    );
    const remove = new Set(
      released.slice(0, Math.max(0, released.length - keep)),
    );
    next.intents = next.intents.filter((intent) => !remove.has(intent));
  }

  private observeClock(floor: number): number {
    const now = this.clock();
    if (!integer(now) || now < Math.max(floor, this.clockFloor))
      throw new Error('Host admission clock moved backwards');
    // Failed or uncertain writes must not reset this process's clock floor.
    this.clockFloor = now;
    return now;
  }

  private change<T>(
    update: (next: Journal, now: number) => T | Promise<T>,
  ): Promise<T> {
    const operation = this.writing.then(() => this.apply(update));
    // Preserve the caller's failure while allowing reconciliation reads and
    // later owned mutations; no log includes a command or raw journal.
    this.writing = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async apply<T>(
    update: (next: Journal, now: number) => T | Promise<T>,
  ): Promise<T> {
    await this.assertOwner();
    const next = structuredClone(this.snapshot());
    const now = this.observeClock(next.lastObservedAt);
    const before = JSON.stringify(next);
    const result = await update(next, now);
    const dispatched = next.intents.filter(
      (intent) =>
        (intent.state === 'dispatching' &&
          this.state?.intents.find((row) => row.id === intent.id)?.state ===
            'reserved') ||
        (intent.pendingUse !== null &&
          this.state?.intents.find((row) => row.id === intent.id)
            ?.pendingUse !== intent.pendingUse),
    );
    this.compact(next);
    if (!Number.isSafeInteger(next.epoch))
      throw new Error('Host admission epoch exhausted');
    await this.assertOwner();
    const finalNow = this.observeClock(now);
    // A slow owner read cannot turn an expired sample into a launch.
    if (dispatched.some((intent) => finalNow > intent.startBefore))
      throw new Error('Host admission start window expired');
    if (JSON.stringify(next) !== before) {
      next.lastObservedAt = finalNow;
      await this.persist(next);
    }
    await this.assertOwner();
    const returnedAt = this.observeClock(finalNow);
    // This last refusal may follow a committed dispatch marker. It must
    // remain occupied; the caller never receives permission to launch.
    if (dispatched.some((intent) => returnedAt > intent.startBefore))
      throw new Error('Host admission start window expired');
    return result;
  }

  private async persist(next: Journal): Promise<void> {
    const raw = JSON.stringify(next);
    if (Buffer.byteLength(raw) > MAX_BYTES)
      throw new Error('Host admission journal is full');
    await this.writeSnapshot(this.file, raw, () => {
      this.state = next;
    });
  }
}
