import { afterEach, describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeDurableSnapshot } from './durable-snapshot.ts';
import {
  HostAdmissionJournal,
  ordinaryAdmissionId,
  type NativeAdmissionContainer,
} from './host-admission-journal.ts';
import type {
  HostAdmissionReading,
  HostAdmissionRequest,
} from './host-admission-model.ts';

const GIB = 1024 ** 3;
const HASH = 'a'.repeat(64);
const CID = 'b'.repeat(64);
const ORDINARY = ordinaryAdmissionId(0);
const identity = {
  daemonId: 'daemon',
  hostBootId: 'boot',
  filesystemId: 'filesystem',
  authorityGeneration: 'owner',
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'host-admission-journal-'));
  roots.push(root);
  const file = join(root, 'admission.json');
  const owner = { current: true, reads: 0, onRead: (_count: number) => {} };
  const time = { now: 20_000 };
  const clock = () => time.now;
  const assertOwner = () => {
    owner.reads++;
    owner.onRead(owner.reads);
    if (!owner.current) throw new Error('Owner changed');
    return Promise.resolve();
  };
  const journal = new HostAdmissionJournal(file, identity, assertOwner, clock);
  await journal.load();
  return { file, journal, owner, assertOwner, time, clock };
}

function request(id = 'phase-1', epoch = 0): HostAdmissionRequest {
  return {
    hold: { id, kind: 'phase', memoryBytes: 4 * GIB, diskBytes: 2 * GIB },
    expectedEpoch: epoch,
    nativeDiskReserveBytes: 2 * GIB,
  };
}

function readings(
  first = 10_000,
  last = 20_000,
): [HostAdmissionReading, HostAdmissionReading] {
  const value = {
    identity,
    onlineCpus: 8,
    load1: 0,
    cpuPsi: 0,
    memoryPsi: 0,
    ioPsi: 0,
    memoryTotalBytes: 64 * GIB,
    memoryAvailableBytes: 48 * GIB,
    diskAvailableBytes: 80 * GIB,
  };
  return [
    { ...value, observedAt: first },
    { ...value, observedAt: last },
  ];
}

function binding(id = 'phase-1') {
  return { requestHash: HASH, containerName: id };
}

describe('disabled host admission journal foundation', () => {
  test.each([2, 3])(
    'owner read %i crossing freshness never returns launch permission',
    async (read) => {
      const { journal, owner, time } = await fixture();
      await journal.reserve(request(), binding(), readings());
      const crossing = owner.reads + read;
      owner.onRead = (count) => {
        if (count === crossing) time.now = 50_001;
      };
      await rejects(
        journal.dispatch('phase-1', HASH),
        new RegExp('start window'),
      );
      expect(journal.snapshot().intents[0]?.state).toBe(
        read === 2 ? 'reserved' : 'dispatching',
      );
      expect(journal.snapshot().intents).toHaveLength(1);
    },
  );
  test('durably reserves before dispatch and never re-dispatches the same intent', async () => {
    const { journal, file, assertOwner, time, clock } = await fixture();
    expect(
      await journal.reserve(request(), binding(), readings()),
    ).toMatchObject({ admitted: true, replay: false, epoch: 1 });
    expect(JSON.parse(await readFile(file, 'utf8')).intents[0].state).toBe(
      'reserved',
    );
    expect(await journal.dispatch('phase-1', HASH)).toBe(true);
    const reopened = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
    );
    await reopened.load();
    expect(await reopened.dispatch('phase-1', HASH)).toBe(false);
    expect(reopened.snapshot().intents[0]?.state).toBe('dispatching');
    await rejects(
      reopened.cancelReserved('phase-1', HASH),
      new RegExp('native reconciliation'),
    );
    // Clock age is not a release condition; a lost Docker acknowledgment
    // continues to consume its full reservation after restart.
    time.now = 9_000_000;
    expect(
      await reopened.reserve(request('phase-1'), binding(), readings()),
    ).toMatchObject({
      admitted: true,
      replay: true,
      intent: { state: 'dispatching' },
    });
  });

  test('a concurrent native writer must refresh the epoch after another reservation', async () => {
    const { journal } = await fixture();
    const results = await Promise.all([
      journal.reserve(request('a'), binding('a'), readings()),
      journal.reserve(request('b'), binding('b'), readings()),
    ]);
    expect(results[0]).toMatchObject({ admitted: true });
    expect(results[1]).toMatchObject({ admitted: false, reason: 'stale' });
    expect(journal.snapshot().intents).toHaveLength(1);
  });

  test('matching replay retains the original outcome; conflicting identity never reuses it', async () => {
    const { journal } = await fixture();
    await journal.reserve(request(), binding(), readings());
    for (const change of [
      { requestHash: 'c'.repeat(64), containerName: 'phase-1' },
      { requestHash: HASH, containerName: 'another' },
    ])
      await rejects(
        journal.reserve(request(), change, readings()),
        new RegExp('idempotency'),
      );
    const changed = request();
    changed.hold.memoryBytes++;
    await rejects(
      journal.reserve(changed, binding(), readings()),
      new RegExp('idempotency'),
    );
    await journal.cancelReserved('phase-1', HASH);
    expect(
      await journal.reserve(request(), binding(), readings()),
    ).toMatchObject({ replay: true, intent: { state: 'released' } });
    expect(await journal.dispatch('phase-1', HASH)).toBe(false);
  });

  test('release requires the exact active CID and successful native gone observation', async () => {
    const { journal } = await fixture();
    await journal.reserve(request(), binding(), readings());
    await journal.dispatch('phase-1', HASH);
    await rejects(
      journal.releaseGone('phase-1', HASH, CID, () => Promise.resolve()),
      new RegExp('mismatch'),
    );
    await journal.started('phase-1', HASH, CID);
    await rejects(
      journal.started('phase-1', HASH, 'c'.repeat(64)),
      new RegExp('mismatch'),
    );
    await rejects(
      journal.releaseGone('phase-1', HASH, CID, () =>
        Promise.reject(new Error('still running')),
      ),
      new RegExp('still running'),
    );
    expect(journal.snapshot().intents[0]?.state).toBe('active');
    const observed: string[] = [];
    await journal.releaseGone('phase-1', HASH, CID, (id) => {
      observed.push(id);
      return Promise.resolve();
    });
    expect(observed).toEqual([CID]);
    expect(journal.snapshot().intents[0]?.state).toBe('released');
  });

  test('authority loss during native readback cannot release a hold', async () => {
    const { journal, owner, file } = await fixture();
    await journal.reserve(request(), binding(), readings());
    await journal.dispatch('phase-1', HASH);
    await journal.started('phase-1', HASH, CID);
    const before = await readFile(file, 'utf8');
    await rejects(
      journal.releaseGone('phase-1', HASH, CID, () => {
        owner.current = false;
        return Promise.resolve();
      }),
      new RegExp('Owner changed'),
    );
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(journal.snapshot().intents[0]?.state).toBe('active');
  });

  test('backwards clocks, malformed input and unknown issuers fail before state changes', async () => {
    const { journal, file, time } = await fixture();
    await journal.reserve(request(), binding(), readings());
    const before = await readFile(file, 'utf8');
    time.now = 19_999;
    await rejects(journal.dispatch('phase-1', HASH), new RegExp('clock'));
    time.now = 20_000;
    await rejects(
      journal.dispatch('phase-1', 'd'.repeat(64)),
      new RegExp('Unknown'),
    );
    expect(() =>
      journal.reserve(
        request(),
        { ...binding(), requestHash: 'invalid' },
        readings(),
      ),
    ).toThrow('Invalid');
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  test('malformed, duplicate, foreign-generation and oversized snapshots stay untouched', async () => {
    const { file, assertOwner } = await fixture();
    const original = JSON.parse(await readFile(file, 'utf8'));
    const intent = {
      ...request().hold,
      ...binding(),
      state: 'dispatching',
      containerId: null,
      startBefore: 50_000,
    };
    const cases = [
      '{',
      JSON.stringify({ ...original, extra: true }),
      JSON.stringify({
        ...original,
        identity: { ...identity, authorityGeneration: 'other' },
      }),
      JSON.stringify({ ...original, intents: [intent, intent] }),
      JSON.stringify({
        ...original,
        intents: [{ ...intent, state: 'active' }],
      }),
      ' '.repeat(4 * 1024 * 1024 + 1),
    ];
    for (const raw of cases) {
      await writeFile(file, raw);
      await rejects(
        new HostAdmissionJournal(file, identity, assertOwner).load(),
      );
      expect(await readFile(file, 'utf8')).toBe(raw);
    }
  });

  test('symlinks refuse load and callers cannot mutate a returned snapshot', async () => {
    const { journal, file, assertOwner } = await fixture();
    const copy = journal.snapshot();
    copy.epoch = 99;
    expect(journal.snapshot().epoch).toBe(0);
    const link = `${file}.link`;
    await symlink(file, link);
    await rejects(new HostAdmissionJournal(link, identity, assertOwner).load());
    await rejects(journal.load(), new RegExp('already loaded'));
  });
});

describe('ordinary growth and interrupted-dispatch reconciliation', () => {
  const ordinary = (epoch = 0): HostAdmissionRequest => ({
    ...request(ORDINARY, epoch),
    hold: { ...request(ORDINARY).hold, kind: 'create' },
  });
  async function activeOrdinary() {
    const context = await fixture();
    await context.journal.reserve(ordinary(), binding(ORDINARY), readings());
    await context.journal.dispatch(ORDINARY, HASH);
    await context.journal.started(ORDINARY, HASH, CID);
    return context;
  }

  test('acknowledged ordinary growth settles only after 90 seconds and exact current observation', async () => {
    const { journal, time } = await activeOrdinary();
    const seen: string[] = [];
    const observe = (id: string) => {
      seen.push(id);
      return Promise.resolve();
    };
    time.now = 109_999;
    expect(
      await journal.settleOrdinaryGrowth(ORDINARY, HASH, CID, observe),
    ).toBe(false);
    expect(seen).toHaveLength(0);
    time.now = 110_000;
    expect(
      await journal.settleOrdinaryGrowth(ORDINARY, HASH, CID, observe),
    ).toBe(true);
    expect(seen).toEqual([CID]);
    expect(journal.snapshot().intents[0]?.state).toBe('released');
  });

  test('phase growth never decays, even after a current container observation', async () => {
    const { journal, time } = await fixture();
    await journal.reserve(request(), binding(), readings());
    await journal.dispatch('phase-1', HASH);
    await journal.started('phase-1', HASH, CID);
    time.now = 9_000_000;
    await rejects(
      journal.settleOrdinaryGrowth('phase-1', HASH, CID, () =>
        Promise.resolve(),
      ),
      /mismatch/,
    );
    expect(journal.snapshot().intents[0]?.state).toBe('active');
  });

  test('an immediate ordinary reuse counts one hold and waits for no growth decay', async () => {
    const { journal, time } = await activeOrdinary();
    time.now = 31_001;
    expect(
      await journal.beginOrdinaryUse(
        ORDINARY,
        HASH,
        CID,
        'acquire-1',
        ordinary(journal.snapshot().epoch),
        readings(21_001, 31_001),
      ),
    ).toMatchObject({ admitted: true });
    expect(journal.snapshot().intents).toHaveLength(1);
    expect(journal.snapshot().intents[0]).toMatchObject({
      pendingUse: 'acquire-1',
      startedAt: null,
    });
    await journal.acknowledgeOrdinaryUse(ORDINARY, HASH, CID, 'acquire-1');
    expect(journal.snapshot().intents[0]).toMatchObject({
      pendingUse: null,
      startedAt: 31_001,
    });
  });

  test('lost activity acknowledgment stays occupied forever and health cannot settle it', async () => {
    const { journal, time } = await activeOrdinary();
    time.now = 31_001;
    await journal.beginOrdinaryUse(
      ORDINARY,
      HASH,
      CID,
      'acquire-1',
      ordinary(journal.snapshot().epoch),
      readings(21_001, 31_001),
    );
    time.now = 9_000_000;
    let observed = false;
    expect(
      await journal.settleOrdinaryGrowth(ORDINARY, HASH, CID, () => {
        observed = true;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(observed).toBe(false);
    await rejects(
      journal.beginOrdinaryUse(
        ORDINARY,
        HASH,
        CID,
        'acquire-2',
        ordinary(journal.snapshot().epoch),
        readings(time.now - 10_000, time.now),
      ),
      /reconciliation/,
    );
    await rejects(
      journal.acknowledgeOrdinaryUse(ORDINARY, HASH, CID, 'acquire-2'),
      /mismatch/,
    );
    expect(journal.snapshot().intents[0]?.pendingUse).toBe('acquire-1');
    await journal.releaseGone(ORDINARY, HASH, CID, () => Promise.resolve());
    expect(journal.snapshot().intents[0]).toMatchObject({
      state: 'released',
      pendingUse: null,
    });
  });

  test('uncertain dispatch discovery requires the exact native attempt, never absence', async () => {
    const { journal, time } = await fixture();
    await journal.reserve(ordinary(), binding(ORDINARY), readings());
    await journal.dispatch(ORDINARY, HASH);
    await rejects(
      journal.reconcileDispatched(ORDINARY, HASH, () => Promise.resolve('')),
      /mismatch/,
    );
    expect(journal.snapshot().intents[0]?.state).toBe('dispatching');
    await journal.reconcileDispatched(ORDINARY, HASH, (intent) => {
      expect(intent).toMatchObject({
        id: ORDINARY,
        requestHash: HASH,
        containerName: ORDINARY,
      });
      return Promise.resolve(CID);
    });
    time.now = 9_000_000;
    expect(
      await journal.settleOrdinaryGrowth(ORDINARY, HASH, CID, () =>
        Promise.resolve(),
      ),
    ).toBe(false);
    expect(journal.snapshot().intents[0]).toMatchObject({
      state: 'active',
      containerId: CID,
      startedAt: null,
    });
  });

  test('new authority generation preserves pending holds only behind native prior-owner termination proof', async () => {
    const { journal, file, assertOwner, time, clock } = await activeOrdinary();
    time.now = 31_001;
    await journal.beginOrdinaryUse(
      ORDINARY,
      HASH,
      CID,
      'use-1',
      ordinary(journal.snapshot().epoch),
      readings(21_001, 31_001),
    );
    const nextIdentity = { ...identity, authorityGeneration: 'new-owner' };
    const denied = new HostAdmissionJournal(
      file,
      nextIdentity,
      assertOwner,
      clock,
    );
    await rejects(denied.load(), /reconciliation/);
    await rejects(
      denied.load(() => Promise.reject(new Error('prior owner alive'))),
      /prior owner alive/,
    );
    expect(JSON.parse(await readFile(file, 'utf8')).identity).toEqual(identity);
    const recovered = new HostAdmissionJournal(
      file,
      nextIdentity,
      assertOwner,
      clock,
    );
    await recovered.load((previous) => {
      expect(previous).toEqual(identity);
      return Promise.resolve();
    });
    expect(recovered.snapshot().identity).toEqual(nextIdentity);
    expect(recovered.snapshot().intents).toEqual(journal.snapshot().intents);
    expect(recovered.snapshot().epoch).toBe(journal.snapshot().epoch + 1);
  });
});

describe('bounded ordinary history and reconciliation work', () => {
  test('4097 completed growth cycles stay bounded and old IDs cannot return after reopen or recovery', async () => {
    const { file, time, clock, assertOwner } = await fixture();
    let persisted = '';
    let writes = 0;
    // Exercise every real transition without making a unit test fsync 16,388
    // times. The final snapshot is then persisted and reopened through disk.
    const journal = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
      (_file, raw, committed) => {
        persisted = raw;
        writes++;
        committed();
        return Promise.resolve();
      },
    );
    await journal.load();
    const firstId = ordinaryAdmissionId(journal.snapshot().epoch);
    for (let cycle = 0; cycle < 4097; cycle++) {
      const epoch = journal.snapshot().epoch;
      const id = ordinaryAdmissionId(epoch);
      const ordinary = {
        ...request(id, epoch),
        hold: { ...request(id).hold, kind: 'create' as const },
      };
      expect(
        (
          await journal.reserve(
            ordinary,
            binding('ordinary'),
            readings(time.now - 10_000, time.now),
          )
        ).admitted,
      ).toBe(true);
      expect(await journal.dispatch(id, HASH)).toBe(true);
      await journal.started(id, HASH, CID);
      time.now += 90_000;
      expect(
        await journal.settleOrdinaryGrowth(id, HASH, CID, () =>
          Promise.resolve(),
        ),
      ).toBe(true);
    }
    expect(writes).toBe(4097 * 4);
    expect(journal.snapshot().intents).toHaveLength(128);
    expect(journal.snapshot().intents.some((row) => row.id === firstId)).toBe(
      false,
    );
    await writeDurableSnapshot(file, persisted, () => {});
    const reopened = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
    );
    await reopened.load();
    const stale = () => ({
      ...request(firstId, reopened.snapshot().epoch),
      hold: { ...request(firstId).hold, kind: 'create' as const },
    });
    await rejects(
      reopened.reserve(
        stale(),
        binding('ordinary'),
        readings(time.now - 10_000, time.now),
      ),
      /freshly issued/,
    );
    await rejects(reopened.dispatch(firstId, HASH), /Unknown/);
    await rejects(
      reopened.acknowledgeOrdinaryUse(firstId, HASH, CID, 'late'),
      /Unknown/,
    );
    const priorEpoch = reopened.snapshot().epoch;
    const nextIdentity = { ...identity, authorityGeneration: 'next' };
    const recovered = new HostAdmissionJournal(
      file,
      nextIdentity,
      assertOwner,
      clock,
    );
    await recovered.load(async (prior) => {
      expect(prior).toEqual(identity);
    });
    expect(recovered.snapshot().epoch).toBe(priorEpoch + 1);
    const [first, last] = readings(time.now - 10_000, time.now);
    await rejects(
      recovered.reserve(
        { ...stale(), expectedEpoch: recovered.snapshot().epoch },
        binding('ordinary'),
        [
          { ...first, identity: nextIdentity },
          { ...last, identity: nextIdentity },
        ],
      ),
      /freshly issued/,
    );
  }, 30_000);

  test('legacy identities remain replayable, phases cannot claim issuance UUIDs, and exhaustion refuses', async () => {
    const { journal, file, time, clock, assertOwner } = await fixture();
    const raw = journal.snapshot();
    const legacyId = '12345678-1234-4234-8234-123456789abc';
    raw.epoch = 10;
    raw.intents = [
      {
        ...request(legacyId).hold,
        kind: 'create',
        ...binding('legacy'),
        state: 'released',
        containerId: CID,
        startBefore: 50_000,
        startedAt: null,
        pendingUse: null,
      },
    ];
    await writeFile(file, JSON.stringify(raw));
    const reopened = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
    );
    await reopened.load();
    expect(
      await reopened.reserve(
        {
          ...request(legacyId, 10),
          hold: { ...request(legacyId).hold, kind: 'create' },
        },
        binding('legacy'),
        readings(),
      ),
    ).toMatchObject({ replay: true });
    const issued = ordinaryAdmissionId(10);
    await rejects(
      reopened.reserve(request(issued, 10), binding(), readings()),
      /freshly issued/,
    );
    await rejects(
      reopened.reserve(
        {
          ...request('fresh-arbitrary', 10),
          hold: { ...request('fresh-arbitrary').hold, kind: 'create' },
        },
        binding(),
        readings(),
      ),
      /freshly issued/,
    );
    time.now += 1_000;
    await reopened.reconcileInventory(() => Promise.resolve([]));
    expect(reopened.snapshot().intents[0]?.id).toBe(legacyId);
    expect(() => ordinaryAdmissionId(Number.MAX_SAFE_INTEGER)).toThrow(
      /exhausted/,
    );
    expect(() => ordinaryAdmissionId(-1)).toThrow(/exhausted/);
    expect(() => ordinaryAdmissionId(1.5)).toThrow(/exhausted/);
    expect(ordinaryAdmissionId(Number.MAX_SAFE_INTEGER - 1)).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });

  test('one scan and snapshot settle 20 sessions; a later no-op writes nothing', async () => {
    const { file, journal, time, clock, assertOwner } = await fixture();
    const raw = journal.snapshot();
    raw.epoch = 100;
    raw.lastStartedAt = 20_000;
    raw.lastObservedAt = 20_000;
    const rows: NativeAdmissionContainer[] = [];
    raw.intents = Array.from({ length: 20 }, (_, index) => {
      const id = ordinaryAdmissionId(index);
      const cid = (index + 1).toString(16).padStart(64, '0');
      rows.push({ id: cid, name: `session-${index}`, running: true });
      return {
        ...request(id).hold,
        kind: 'create',
        ...binding(`session-${index}`),
        state: 'active',
        containerId: cid,
        startBefore: 50_000,
        startedAt: 20_000,
        pendingUse: null,
      };
    });
    await writeFile(file, JSON.stringify(raw));
    let writes = 0;
    const counted = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
      async (...args) => {
        writes++;
        await writeDurableSnapshot(...args);
      },
    );
    await counted.load();
    time.now = 110_000;
    let scans = 0;
    const observe = () => {
      scans++;
      return Promise.resolve(rows);
    };
    await counted.reconcileInventory(observe);
    expect(scans).toBe(1);
    expect(writes).toBe(1);
    expect(counted.snapshot().epoch).toBe(101);
    expect(
      counted.snapshot().intents.every((row) => row.state === 'released'),
    ).toBe(true);
    const disk = await readFile(file, 'utf8');
    time.now += 1_000;
    await counted.reconcileInventory(observe);
    expect(scans).toBe(2);
    expect(writes).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(disk);
    time.now--;
    await rejects(counted.reconcileInventory(observe), /clock/);
    expect(scans).toBe(2);
  });

  test('compaction preserves uncertain, pending, active, legacy and phase records', async () => {
    const { file, journal, time, clock, assertOwner } = await fixture();
    const raw = journal.snapshot();
    raw.epoch = 1000;
    raw.lastStartedAt = raw.lastObservedAt = 20_000;
    const base = {
      ...request().hold,
      kind: 'create' as const,
      ...binding(),
      state: 'active' as const,
      containerId: CID,
      startBefore: 50_000,
      startedAt: 20_000,
      pendingUse: null,
    };
    const kept = [
      {
        ...base,
        id: ordinaryAdmissionId(1),
        containerName: 'uncertain',
        state: 'dispatching' as const,
        containerId: null,
        startedAt: null,
      },
      {
        ...base,
        id: ordinaryAdmissionId(2),
        containerName: 'pending',
        pendingUse: 'lost',
        startedAt: null,
      },
      {
        ...base,
        id: ordinaryAdmissionId(3),
        containerName: 'young',
        containerId: 'c'.repeat(64),
        startedAt: 109_000,
      },
      {
        ...base,
        id: 'phase',
        kind: 'phase' as const,
        containerName: 'phase',
        containerId: 'd'.repeat(64),
      },
      {
        ...base,
        id: 'legacy',
        containerName: 'legacy',
        state: 'released' as const,
        startedAt: null,
      },
      {
        ...base,
        id: 'phase-released',
        kind: 'phase' as const,
        containerName: 'phase-released',
        state: 'released' as const,
        startedAt: null,
      },
    ];
    raw.intents = [
      ...kept,
      ...Array.from({ length: 200 }, (_, index) => ({
        ...base,
        id: ordinaryAdmissionId(index + 10),
        state: 'released' as const,
        startedAt: null,
      })),
    ];
    await writeFile(file, JSON.stringify(raw));
    const counted = new HostAdmissionJournal(
      file,
      identity,
      assertOwner,
      clock,
    );
    await counted.load();
    time.now = 110_000;
    await counted.reconcileInventory(() =>
      Promise.resolve([
        { id: CID, name: 'pending', running: true },
        { id: 'c'.repeat(64), name: 'young', running: true },
        { id: 'd'.repeat(64), name: 'phase', running: true },
      ]),
    );
    expect(counted.snapshot().intents).toHaveLength(kept.length + 128);
    expect(counted.snapshot().intents.slice(0, kept.length)).toEqual(kept);
  });

  test('a failed or uncertain write retains the process clock floor', async () => {
    for (const commit of [false, true]) {
      const { file, time, clock, assertOwner } = await fixture();
      const journal = new HostAdmissionJournal(
        file,
        identity,
        assertOwner,
        clock,
        (_file, _raw, committed) => {
          if (commit) committed();
          return Promise.reject(new Error('flush failed'));
        },
      );
      await journal.load();
      time.now = 30_000;
      await rejects(
        journal.reserve(request(), binding(), readings(20_000, 30_000)),
        /flush failed/,
      );
      time.now = 29_999;
      await rejects(
        journal.reconcileInventory(() => Promise.resolve([])),
        /clock/,
      );
      expect(journal.snapshot().intents).toHaveLength(commit ? 1 : 0);
    }
  });

  test('recovery refuses a backwards clock and a future encoded attempt cannot load', async () => {
    const { file, journal, clock, time, assertOwner } = await fixture();
    await journal.reserve(request(), binding(), readings());
    const before = await readFile(file, 'utf8');
    time.now--;
    const recovered = new HostAdmissionJournal(
      file,
      { ...identity, authorityGeneration: 'next' },
      assertOwner,
      clock,
    );
    await rejects(
      recovered.load(() => Promise.resolve()),
      /clock/,
    );
    expect(await readFile(file, 'utf8')).toBe(before);
    time.now++;
    const raw = journal.snapshot();
    raw.intents[0] = {
      ...raw.intents[0]!,
      id: ordinaryAdmissionId(raw.epoch),
      kind: 'create',
    };
    await writeFile(file, JSON.stringify(raw));
    await rejects(
      new HostAdmissionJournal(file, identity, assertOwner, clock).load(),
      /identity/,
    );
  });

  test('one failed complete observation cannot partially retire a batch', async () => {
    const { file, journal, owner, time } = await fixture();
    await journal.reserve(request(), binding(), readings());
    await journal.dispatch('phase-1', HASH);
    await journal.started('phase-1', HASH, CID);
    const before = await readFile(file, 'utf8');
    time.now = 110_000;
    await rejects(
      journal.reconcileInventory(() => Promise.reject(new Error('incomplete'))),
      /incomplete/,
    );
    await rejects(
      journal.reconcileInventory(() =>
        Promise.resolve([{ id: 'short', name: 'invalid', running: true }]),
      ),
      /mismatch/,
    );
    await rejects(
      journal.reconcileInventory(() => {
        owner.current = false;
        return Promise.resolve([]);
      }),
      /Owner changed/,
    );
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(journal.snapshot().intents[0]?.state).toBe('active');
  });
});
