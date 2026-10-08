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
const HASH = /^[a-f0-9]{64}$/;

export interface HostAdmissionIntent extends HostAdmissionHold {
  requestHash: string;
  containerName: string;
  state: 'reserved' | 'dispatching' | 'active' | 'released';
  containerId: string | null;
  startBefore: number;
}

interface Journal {
  version: 1;
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
    (row.containerId !== null &&
      (typeof row.containerId !== 'string' || !HASH.test(row.containerId))) ||
    (row.state === 'active' && row.containerId === null) ||
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
    row.version !== 1 ||
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
  if (
    new Set(intents.map((intent) => intent.id)).size !== intents.length ||
    new Set(
      intents
        .filter((intent) => intent.state !== 'released')
        .map((intent) => intent.containerName),
    ).size !== intents.filter((intent) => intent.state !== 'released').length
  )
    throw new Error('Duplicate host admission identity');
  return {
    version: 1,
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

  constructor(
    private readonly file: string,
    private readonly identity: HostAdmissionIdentity,
    // Native authority callback, never a wire boolean. It must throw on a
    // missing/changed owner, including after a slow disk or daemon call.
    private readonly assertOwner: () => Promise<void>,
    private readonly clock: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
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
        next = parseJournal(
          new TextDecoder('utf-8', { fatal: true }).decode(
            bytes.subarray(0, length),
          ),
          this.identity,
        );
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
        version: 1,
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
      if (intent.state === 'active') return;
      intent.state = 'active';
      intent.containerId = containerId;
      next.lastStartedAt = now;
      next.epoch++;
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
      intent.state = 'released';
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
      intent.state = 'released';
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
    const now = this.clock();
    if (!integer(now) || now < next.lastObservedAt)
      throw new Error('Host admission clock moved backwards');
    const before = JSON.stringify(next);
    const result = await update(next, now);
    const dispatched = next.intents.filter(
      (intent) =>
        intent.state === 'dispatching' &&
        this.state?.intents.find((row) => row.id === intent.id)?.state ===
          'reserved',
    );
    next.lastObservedAt = now;
    if (!Number.isSafeInteger(next.epoch))
      throw new Error('Host admission epoch exhausted');
    await this.assertOwner();
    const finalNow = this.clock();
    if (!integer(finalNow) || finalNow < now)
      throw new Error('Host admission clock moved backwards');
    // A slow owner read cannot turn an expired sample into a launch.
    if (dispatched.some((intent) => finalNow > intent.startBefore))
      throw new Error('Host admission start window expired');
    next.lastObservedAt = finalNow;
    if (JSON.stringify(next) !== before) await this.persist(next);
    await this.assertOwner();
    const returnedAt = this.clock();
    if (!integer(returnedAt) || returnedAt < finalNow)
      throw new Error('Host admission clock moved backwards');
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
    await writeDurableSnapshot(this.file, raw, () => {
      this.state = next;
    });
  }
}
