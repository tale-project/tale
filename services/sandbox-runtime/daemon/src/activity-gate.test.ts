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

  test('an idle cutoff can freeze a held session without changing pressure eligibility', () => {
    const gate = new ActivityGate(
      () => 0,
      () => 100,
    );
    expect(gate.snapshot().idleReclaim).toBe(true);
    const generation = gate.snapshot().generation;
    expect(gate.claim('pressure', generation)).toBe(false);
    expect(gate.claim('idle', generation, 99)).toBe(false);
    expect(gate.claim('idle', generation, 100)).toBe(true);
    expect(gate.acquire()).toBeNull();
    expect(gate.enter()).toBeNull();
  });

  test('new activity or a reacquire defeats a stale idle decision', () => {
    let lastActivityAtMs = 100;
    const gate = new ActivityGate(
      () => 0,
      () => lastActivityAtMs,
    );
    const generation = gate.snapshot().generation;
    const finish = gate.enter();
    expect(gate.claim('during-operation', generation, 100)).toBe(false);
    lastActivityAtMs = 101;
    finish?.();
    expect(gate.claim('after-operation', generation, 100)).toBe(false);
    const current = gate.acquire();
    expect(gate.claim('before-acquire', generation, 101)).toBe(false);
    expect(gate.claim('after-acquire', String(current), 101)).toBe(true);
  });

  test('idle expiry still protects pinned sessions and live execs', () => {
    let liveExecs = 0;
    const gate = new ActivityGate(
      () => liveExecs,
      () => 0,
    );
    const generation = gate.snapshot().generation;
    gate.setPinned(true);
    expect(gate.claim('pinned', generation, 100)).toBe(false);
    gate.setPinned(false);
    liveExecs = 1;
    expect(gate.claim('busy', generation, 100)).toBe(false);
    liveExecs = 0;
    expect(gate.claim('idle', generation, 100)).toBe(true);
  });

  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('refuses a malformed idle cutoff (%s)', (cutoff) => {
    const gate = new ActivityGate(
      () => 0,
      () => 0,
    );
    gate.release(gate.snapshot().generation);
    expect(gate.claim('bad-cutoff', gate.snapshot().generation, cutoff)).toBe(
      false,
    );
    expect(gate.snapshot().reclaiming).toBe(false);
  });

  test('a gate with no activity clock never accepts an idle cutoff', () => {
    const gate = new ActivityGate(() => 0);
    gate.release(gate.snapshot().generation);
    expect(gate.snapshot().idleReclaim).toBeUndefined();
    expect(gate.claim('idle', gate.snapshot().generation, 100)).toBe(false);
    expect(gate.claim('pressure', gate.snapshot().generation)).toBe(true);
  });
});
