import { afterEach, describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HostAdmissionJournal } from './host-admission-journal.ts';
import type {
  HostAdmissionReading,
  HostAdmissionRequest,
} from './host-admission-model.ts';

const GIB = 1024 ** 3;
const HASH = 'a'.repeat(64);
const CID = 'b'.repeat(64);
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
