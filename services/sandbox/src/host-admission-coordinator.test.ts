import { afterEach, describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HostAdmissionCoordinator,
  type AdmissionContainer,
} from './host-admission-coordinator.ts';
import { claimAdmissionDirectory } from './host-admission-directory.ts';
import {
  HostAdmissionJournal,
  ordinaryAdmissionId,
} from './host-admission-journal.ts';
import type { HostAdmissionReading } from './host-admission-model.ts';
import { sessionContainerName } from './session/session-naming.ts';

const GIB = 1024 ** 3;
const identity = {
  daemonId: 'daemon',
  hostBootId: 'boot',
  filesystemId: 'fs',
  authorityGeneration: 'owner',
};
const roots: string[] = [];
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close().catch(() => undefined);
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

function spec(sessionId = 'session') {
  return {
    sessionId,
    createdAtMs: 1_000,
    memoryBytes: 4 * GIB,
    diskBytes: 2 * GIB,
  };
}
function container(
  sessionId = 'session',
  attempt = 'prior',
  id = 'a'.repeat(64),
): AdmissionContainer {
  return {
    id,
    sessionId,
    name: sessionContainerName(sessionId),
    createAttemptId: attempt,
    createdAtMs: 1_000,
    running: true,
  };
}
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'coordinator-'));
  roots.push(root);
  const state = {
    now: 20_000,
    owner: true,
    telemetry: true,
    topology: true,
    rows: [] as AdmissionContainer[],
    memory: 48 * GIB,
    inventoryReads: 0,
  };
  const assertOwner = () =>
    state.owner ? Promise.resolve() : Promise.reject(new Error('owner gone'));
  const ports = {
    root,
    identity,
    assertOwner,
    clock: () => state.now,
    diskReserveBytes: 20 * GIB,
    inventory: () => {
      state.inventoryReads++;
      return state.topology
        ? Promise.resolve(structuredClone(state.rows))
        : Promise.reject(new Error('foreign writer'));
    },
    readings: (): Promise<
      readonly [HostAdmissionReading, HostAdmissionReading]
    > => {
      if (!state.telemetry)
        return Promise.reject(new Error('unknown telemetry'));
      const reading = {
        identity,
        onlineCpus: 8,
        load1: 0,
        cpuPsi: 0,
        memoryPsi: 0,
        ioPsi: 0,
        memoryTotalBytes: 64 * GIB,
        memoryAvailableBytes: state.memory,
        diskAvailableBytes: 80 * GIB,
      };
      return Promise.resolve([
        { ...reading, observedAt: state.now - 10_000 },
        { ...reading, observedAt: state.now },
      ]);
    },
  };
  const open = async () => {
    const coordinator = await HostAdmissionCoordinator.open(ports);
    closing.push(() => coordinator.close());
    return coordinator;
  };
  const snapshot = async () => {
    const value: {
      intents: {
        id: string;
        state: string;
        pendingUse: string | null;
        containerId: string | null;
        startedAt: number | null;
      }[];
    } = JSON.parse(
      await readFile(join(root, '.host-admission', 'journal.json'), 'utf8'),
    );
    return value;
  };
  return { root, state, ports, open, snapshot };
}

describe('single disabled native admission coordinator', () => {
  test('one coordinator owns a canonical private path; close permits an explicit reopen', async () => {
    const { open } = await fixture();
    const first = await open();
    await rejects(open(), /already exists/);
    await first.close();
    await open();
  });

  test('symlinked or group-writable admission directories refuse before opening a journal', async () => {
    const { root, open } = await fixture();
    const target = join(root, 'target');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, join(root, '.host-admission'));
    await rejects(open());
    await rm(join(root, '.host-admission'));
    await mkdir(join(root, '.host-admission'), { mode: 0o700 });
    await chmod(join(root, '.host-admission'), 0o770);
    await rejects(open(), /private/);
  });

  test('replacing the owned directory invalidates all subsequent journal writes', async () => {
    const { root } = await fixture();
    const owned = await claimAdmissionDirectory(root);
    closing.push(owned.close);
    await rename(join(root, '.host-admission'), join(root, 'old'));
    await mkdir(join(root, '.host-admission'), { mode: 0o700 });
    await rejects(owned.assertCurrent(), /changed/);
  });

  test('create publishes dispatch identity before the backend sees its exact attempt', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    expect(
      await coordinator.create(spec(), async (attempt) => {
        expect(attempt).toMatch(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
        );
        expect((await snapshot()).intents[0]).toMatchObject({
          id: attempt,
          state: 'dispatching',
        });
        state.rows.push(container('session', attempt));
        return 'ready';
      }),
    ).toBe('ready');
    expect((await snapshot()).intents[0]).toMatchObject({
      state: 'active',
      containerId: 'a'.repeat(64),
      startedAt: 20_000,
    });
  });

  test('unknown telemetry refuses create and activity use without any backend dispatch', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    state.telemetry = false;
    let launched = false;
    await rejects(
      coordinator.create(spec(), () => {
        launched = true;
        return Promise.resolve();
      }),
      /telemetry/,
    );
    state.rows.push(container());
    await rejects(coordinator.beginUse(spec()), /telemetry/);
    expect(launched).toBe(false);
    expect((await snapshot()).intents).toHaveLength(0);
  });

  test('a mode-off or unknown competing writer closes enabled admission', async () => {
    const { state, open } = await fixture();
    const coordinator = await open();
    state.topology = false;
    await rejects(
      coordinator.create(spec(), () => Promise.resolve()),
      /foreign writer/,
    );
    await rejects(coordinator.beginUse(spec()), /foreign writer/);
  });

  test('a lost create response stays held after a missing object, then binds only its exact attempt', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    let attempt = '';
    await rejects(
      coordinator.create(spec(), (id) => {
        attempt = id;
        return Promise.reject(new Error('lost reply'));
      }),
      /lost reply/,
    );
    state.now = 9_000_000;
    await coordinator.reconcile();
    expect((await snapshot()).intents[0]?.state).toBe('dispatching');
    state.rows.push(container('session', 'different'));
    await coordinator.reconcile();
    expect((await snapshot()).intents[0]?.state).toBe('dispatching');
    state.rows[0] = container('session', attempt);
    await coordinator.reconcile();
    expect((await snapshot()).intents[0]).toMatchObject({
      state: 'active',
      startedAt: null,
    });
  });

  test('a backend success for another attempt never acknowledges this reservation', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    await rejects(
      coordinator.create(spec(), () => {
        state.rows.push(container());
        return Promise.resolve();
      }),
      /unavailable/,
    );
    expect((await snapshot()).intents[0]?.state).toBe('dispatching');
  });

  test('startup followed by acquire and fresh exec reuses one growth hold without 90-second delay', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    await coordinator.create(spec(), (id) => {
      state.rows.push(container('session', id));
      return Promise.resolve();
    });
    state.now = 31_001;
    const acquire = await coordinator.beginUse(spec());
    await coordinator.acknowledge(acquire);
    // The same still-fresh post-start pair covers already-reserved growth.
    const exec = await coordinator.beginUse(spec());
    await coordinator.acknowledge(exec);
    expect((await snapshot()).intents).toHaveLength(1);
    expect((await snapshot()).intents[0]).toMatchObject({
      state: 'active',
      pendingUse: null,
    });
  });

  test('an idle existing container can reserve and authorize use with one sample pair', async () => {
    const { state, open, snapshot } = await fixture();
    state.rows.push(container());
    const coordinator = await open();
    const use = await coordinator.beginUse(spec());
    expect((await snapshot()).intents[0]).toMatchObject({
      state: 'active',
      pendingUse: use.useId,
    });
    await coordinator.acknowledge(use);
  });

  test('healthy inventory after a lost activity reply never clears pending use', async () => {
    const { state, open, snapshot } = await fixture();
    state.rows.push(container());
    const coordinator = await open();
    const use = await coordinator.beginUse(spec());
    state.now = 9_000_000;
    await coordinator.reconcile();
    expect((await snapshot()).intents[0]?.pendingUse).toBe(use.useId);
    await rejects(coordinator.beginUse(spec()), /reconciliation/);
    state.rows = [];
    await coordinator.reconcile();
    expect((await snapshot()).intents[0]).toMatchObject({
      state: 'released',
      pendingUse: null,
    });
  });

  test('slow Docker startup does not hold the decision queue and serialize the fleet', async () => {
    const { state, open, snapshot } = await fixture();
    const coordinator = await open();
    const entered = Promise.withResolvers<void>();
    const complete = Promise.withResolvers<void>();
    const first = coordinator.create(spec('first'), async (id) => {
      entered.resolve();
      await complete.promise;
      state.rows.push(container('first', id));
    });
    await entered.promise;
    state.now = 31_001;
    await coordinator.create(spec('second'), (id) => {
      state.rows.push(container('second', id, 'b'.repeat(64)));
      return Promise.resolve();
    });
    expect((await snapshot()).intents.map((row) => row.state)).toEqual([
      'dispatching',
      'active',
    ]);
    complete.resolve();
    await first;
    expect((await snapshot()).intents.map((row) => row.state)).toEqual([
      'active',
      'active',
    ]);
  });

  test('ordinary starts include existing phase holds even without any organization phase-tool grant', async () => {
    const { root, state, ports, open } = await fixture();
    await mkdir(join(root, '.host-admission'), { mode: 0o700 });
    const journal = new HostAdmissionJournal(
      join(root, '.host-admission', 'journal.json'),
      identity,
      ports.assertOwner,
      ports.clock,
    );
    await journal.load();
    await journal.reserve(
      {
        hold: {
          id: 'phase',
          kind: 'phase',
          memoryBytes: 30 * GIB,
          diskBytes: GIB,
        },
        expectedEpoch: 0,
        nativeDiskReserveBytes: 20 * GIB,
      },
      { requestHash: 'a'.repeat(64), containerName: 'phase-container' },
      await ports.readings(),
    );
    await journal.dispatch('phase', 'a'.repeat(64));
    state.now = 31_001;
    const coordinator = await open();
    state.memory = 35 * GIB;
    let launched = false;
    await rejects(
      coordinator.create(spec(), () => {
        launched = true;
        return Promise.resolve();
      }),
      /unavailable/,
    );
    expect(launched).toBe(false);
  });

  test('20-session reconciliation uses one inventory scan at each growth age', async () => {
    const { root, state, ports, open, snapshot } = await fixture();
    await mkdir(join(root, '.host-admission'), { mode: 0o700 });
    const file = join(root, '.host-admission', 'journal.json');
    const journal = new HostAdmissionJournal(
      file,
      identity,
      ports.assertOwner,
      ports.clock,
    );
    await journal.load();
    const seed = journal.snapshot();
    seed.epoch = 100;
    seed.lastStartedAt = seed.lastObservedAt = state.now;
    seed.intents = Array.from({ length: 20 }, (_, index) => {
      const session = `fleet-${index}`;
      const id = ordinaryAdmissionId(index);
      const current = container(
        session,
        id,
        (index + 1).toString(16).padStart(64, '0'),
      );
      state.rows.push(current);
      return {
        id,
        kind: 'create',
        memoryBytes: GIB,
        diskBytes: 0,
        requestHash: 'a'.repeat(64),
        containerName: current.name,
        state: 'active',
        containerId: current.id,
        startBefore: 50_000,
        startedAt: state.now,
        pendingUse: null,
      };
    });
    await writeFile(file, JSON.stringify(seed));
    const coordinator = await open();
    expect(state.inventoryReads).toBe(1);
    const before = await readFile(file, 'utf8');
    state.now++;
    await coordinator.reconcile();
    expect(state.inventoryReads).toBe(2);
    expect(await readFile(file, 'utf8')).toBe(before);
    state.now = 110_000;
    await coordinator.reconcile();
    expect(state.inventoryReads).toBe(3);
    expect(
      (await snapshot()).intents.every((row) => row.state === 'released'),
    ).toBe(true);
    state.now++;
    const use = await coordinator.beginUse({
      ...spec('fleet-0'),
      memoryBytes: GIB,
      diskBytes: 0,
    });
    // One reconciliation scan and one exact binding revalidation, independent
    // of how many peer sessions the host has. Only real use is acknowledged.
    expect(state.inventoryReads).toBe(5);
    await coordinator.acknowledge(use);
    expect(state.inventoryReads).toBe(6);
  });
});
