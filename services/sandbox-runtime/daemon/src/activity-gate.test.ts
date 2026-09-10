import { describe, expect, test } from 'bun:test';

import { ActivityGate } from './activity-gate.ts';

describe('atomic idle reclamation gate', () => {
  test('new and reacquired allocations cannot be reclaimed', () => {
    const gate = new ActivityGate(() => 0);
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(false);
    const old = gate.snapshot().generation;
    expect(gate.release(old)).toBe(true);
    expect(gate.acquire()).not.toBe(old);
    expect(gate.release(old)).toBe(false);
    expect(gate.claim('stale', old)).toBe(false);
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(false);
  });

  test('body ingestion and staging count before exec creation and until I/O finishes', () => {
    const gate = new ActivityGate(() => 0);
    const finish = gate.enter();
    expect(gate.snapshot().activeOperations).toBe(1);
    expect(gate.release(gate.snapshot().generation)).toBe(false);
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(false);
    finish?.();
    expect(gate.release(gate.snapshot().generation)).toBe(true);
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(true);
  });

  test('pinned or running execs exclude reclamation, including detached execs', () => {
    let liveExecs = 0;
    const gate = new ActivityGate(() => liveExecs);
    gate.release(gate.snapshot().generation);
    gate.setPinned(true);
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(false);
    gate.setPinned(false);
    liveExecs = 1;
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(false);
    liveExecs = 0;
    expect(gate.claim('claim', gate.snapshot().generation)).toBe(true);
  });

  test('a successful claim freezes every operation and can be resumed by another spawner without admitting work', () => {
    const gate = new ActivityGate(() => 0);
    gate.release(gate.snapshot().generation);
    expect(gate.claim('owner', gate.snapshot().generation)).toBe(true);
    expect(gate.claim('other', gate.snapshot().generation)).toBe(true);
    expect(gate.claim('owner', gate.snapshot().generation)).toBe(true);
    expect(gate.enter()).toBeNull();
    expect(gate.acquire()).toBeNull();
    expect(gate.setPinned(true)).toBe(false);
    expect(gate.release(gate.snapshot().generation)).toBe(false);
  });

  test('a passive workspace read only protects its in-flight I/O', () => {
    const gate = new ActivityGate(() => 0);
    gate.release(gate.snapshot().generation);
    const finish = gate.enter(false);
    expect(gate.claim('during-read', gate.snapshot().generation)).toBe(false);
    finish?.();
    expect(gate.claim('after-read', gate.snapshot().generation)).toBe(true);
  });
});
