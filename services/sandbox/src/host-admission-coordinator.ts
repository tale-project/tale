// One native owner serializes every growth writer. This module is disabled:
// no boot option or phase route instantiates it until native topology and
// restart proof is complete. Dependencies are native adapters, never wire data.
import { createHash, randomUUID } from 'node:crypto';

import { claimAdmissionDirectory } from './host-admission-directory.ts';
import {
  HostAdmissionJournal,
  ordinaryAdmissionId,
  type HostAdmissionIntent,
  type NativeAdmissionContainer as AdmissionContainer,
} from './host-admission-journal.ts';
import type {
  HostAdmissionIdentity,
  HostAdmissionReading,
} from './host-admission-model.ts';
import { sessionContainerName } from './session/session-naming.ts';

export type { NativeAdmissionContainer as AdmissionContainer } from './host-admission-journal.ts';

interface NativeAdmissionPorts {
  root: string;
  identity: HostAdmissionIdentity;
  assertOwner: () => Promise<void>;
  /** Complete daemon inventory with incompatible writers refused natively. */
  inventory: () => Promise<readonly AdmissionContainer[]>;
  /** Current strict native pair; unknown/stale evidence must throw/refuse. */
  readings: (
    after: number,
  ) => Promise<readonly [HostAdmissionReading, HostAdmissionReading]>;
  assertPriorRetired?: (identity: HostAdmissionIdentity) => Promise<void>;
  memoryReserveBytes?: number;
  diskReserveBytes: number;
  clock?: () => number;
}

export class HostAdmissionUnavailable extends Error {
  constructor() {
    super('Native host admission is unavailable');
  }
}

export interface NativeGrowthSpec {
  sessionId: string;
  createdAtMs: number;
  memoryBytes: number;
  diskBytes: number;
}

export interface NativeGrowthTicket {
  id: string;
  requestHash: string;
  containerId: string;
  useId: string;
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;

export class HostAdmissionCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly ports: NativeAdmissionPorts,
    private readonly directory: Awaited<
      ReturnType<typeof claimAdmissionDirectory>
    >,
    private readonly journal: HostAdmissionJournal,
  ) {}

  static async open(
    ports: NativeAdmissionPorts,
  ): Promise<HostAdmissionCoordinator> {
    const directory = await claimAdmissionDirectory(ports.root);
    try {
      const assertOwner = async () => {
        await directory.assertCurrent();
        await ports.assertOwner();
      };
      await assertOwner();
      const journal = new HostAdmissionJournal(
        directory.file,
        ports.identity,
        assertOwner,
        ports.clock,
      );
      await journal.load(ports.assertPriorRetired);
      const coordinator = new HostAdmissionCoordinator(
        ports,
        directory,
        journal,
      );
      await coordinator.reconcile();
      return coordinator;
    } catch (error) {
      await directory.close();
      throw error;
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      if (this.closed) throw new HostAdmissionUnavailable();
      await this.directory.assertCurrent();
      await this.ports.assertOwner();
      return operation();
    });
    this.queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  private async inventory(): Promise<readonly AdmissionContainer[]> {
    const rows = await this.ports.inventory();
    if (
      rows.length > 4096 ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      new Set(rows.map((row) => row.name)).size !== rows.length ||
      rows.some(
        (row) =>
          !HASH.test(row.id) ||
          !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(row.name) ||
          typeof row.running !== 'boolean' ||
          (row.sessionId !== undefined &&
            (!ID.test(row.sessionId) ||
              row.name !== sessionContainerName(row.sessionId) ||
              !ID.test(row.createAttemptId ?? '') ||
              !Number.isSafeInteger(row.createdAtMs) ||
              (row.createdAtMs ?? 0) <= 0)),
      )
    )
      throw new HostAdmissionUnavailable();
    await this.ports.assertOwner();
    return rows;
  }

  private async reconcileNow(): Promise<readonly AdmissionContainer[]> {
    return this.journal.reconcileInventory(() => this.inventory());
  }

  reconcile(): Promise<void> {
    return this.exclusive(async () => {
      await this.reconcileNow();
    });
  }

  /** A deterministic native attempt label is persisted before Docker runs.
   * Callback failure deliberately leaves the hold, even when cleanup claims
   * success; reconciliation must observe the exact object independently. */
  async create<T>(
    spec: NativeGrowthSpec,
    launch: (attemptId: string) => Promise<T>,
  ): Promise<T> {
    const intent = await this.exclusive(async () => {
      await this.reconcileNow();
      const reserved = await this.reserve(spec, 'create');
      if (!(await this.journal.dispatch(reserved.id, reserved.requestHash)))
        throw new HostAdmissionUnavailable();
      return reserved;
    });
    // Docker starts may overlap. Only the durable admission decision is
    // serialized; holding the queue through health waits serializes a fleet.
    const result = await launch(intent.id);
    await this.exclusive(async () => {
      const found = (await this.inventory()).find(
        (row) =>
          row.createAttemptId === intent.id &&
          row.name === intent.containerName &&
          row.createdAtMs === spec.createdAtMs,
      );
      if (!found?.running) throw new HostAdmissionUnavailable();
      await this.journal.started(intent.id, intent.requestHash, found.id);
    });
    return result;
  }

  /** All fresh acquire/exec writers enter here, including already-busy
   * sessions. A retained exec attaches elsewhere and never reaches beginUse. */
  beginUse(spec: NativeGrowthSpec): Promise<NativeGrowthTicket> {
    return this.exclusive(async () => {
      const rows = await this.reconcileNow();
      const container = rows.find(
        (row) =>
          row.sessionId === spec.sessionId &&
          row.createdAtMs === spec.createdAtMs &&
          row.running,
      );
      if (!container) throw new HostAdmissionUnavailable();
      const snapshot = this.journal.snapshot();
      let intent = snapshot.intents.find(
        (row) =>
          row.state !== 'released' && row.containerName === container.name,
      );
      if (!intent) {
        intent = await this.reserve(spec, 'activate');
        // Binding is not dispatch; fresh pressure evidence can authorize the
        // ensuing RPC without a self-created second sampling delay.
        await this.journal.bindExistingActivation(
          intent.id,
          intent.requestHash,
          async () => {
            const current = (await this.inventory()).find(
              (row) => row.id === container.id && row.running,
            );
            if (!current || current.createdAtMs !== spec.createdAtMs)
              throw new HostAdmissionUnavailable();
            return current.id;
          },
        );
      }
      if (
        intent.kind === 'phase' ||
        intent.state === 'dispatching' ||
        intent.state === 'reserved'
      ) {
        intent = this.journal
          .snapshot()
          .intents.find((row) => row.id === intent?.id);
      }
      if (
        !intent ||
        intent.kind === 'phase' ||
        intent.state !== 'active' ||
        intent.containerId !== container.id
      )
        throw new HostAdmissionUnavailable();
      const useId = randomUUID();
      const readings = await this.ports.readings(
        this.journal.snapshot().lastStartedAt,
      );
      const decision = await this.journal.beginOrdinaryUse(
        intent.id,
        intent.requestHash,
        container.id,
        useId,
        {
          hold: {
            id: intent.id,
            kind: intent.kind,
            memoryBytes: intent.memoryBytes,
            diskBytes: intent.diskBytes,
          },
          expectedEpoch: this.journal.snapshot().epoch,
          nativeMemoryReserveBytes: this.ports.memoryReserveBytes,
          nativeDiskReserveBytes: this.ports.diskReserveBytes,
        },
        readings,
      );
      if (!decision.admitted) throw new HostAdmissionUnavailable();
      return {
        id: intent.id,
        requestHash: intent.requestHash,
        containerId: container.id,
        useId,
      };
    });
  }

  acknowledge(ticket: NativeGrowthTicket): Promise<void> {
    return this.exclusive(async () => {
      if (
        !(await this.inventory()).some(
          (row) => row.id === ticket.containerId && row.running,
        )
      )
        throw new HostAdmissionUnavailable();
      await this.journal.acknowledgeOrdinaryUse(
        ticket.id,
        ticket.requestHash,
        ticket.containerId,
        ticket.useId,
      );
    });
  }

  private async reserve(
    spec: NativeGrowthSpec,
    kind: 'create' | 'activate',
  ): Promise<HostAdmissionIntent> {
    if (
      !ID.test(spec.sessionId) ||
      !Number.isSafeInteger(spec.createdAtMs) ||
      spec.createdAtMs <= 0
    )
      throw new HostAdmissionUnavailable();
    const id = ordinaryAdmissionId(this.journal.snapshot().epoch);
    const readings = await this.ports.readings(
      this.journal.snapshot().lastStartedAt,
    );
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ kind, ...spec }))
      .digest('hex');
    const result = await this.journal.reserve(
      {
        hold: {
          id,
          kind,
          memoryBytes: spec.memoryBytes,
          diskBytes: spec.diskBytes,
        },
        expectedEpoch: this.journal.snapshot().epoch,
        nativeMemoryReserveBytes: this.ports.memoryReserveBytes,
        nativeDiskReserveBytes: this.ports.diskReserveBytes,
      },
      { requestHash, containerName: sessionContainerName(spec.sessionId) },
      readings,
    );
    if (!result.admitted || result.replay) throw new HostAdmissionUnavailable();
    return result.intent;
  }

  /** Owned teardown only after every queued caller settles. */
  close(): Promise<void> {
    return this.exclusive(async () => {
      this.closed = true;
      await this.directory.close();
    });
  }
}
