// The runnerd wire protocol exists twice on purpose: this workspace's
// runnerd-protocol.ts is the canonical copy and the daemon's
// services/sandbox-runtime/daemon/src/protocol.ts is a hand-kept mirror (the
// daemon is bundled into the runtime image and cannot import across the
// service boundary). Each side consumes a different subset, so Knip treats
// the canonical public contract as an entry and excludes the daemon mirror.
// This test keeps them aligned: every exported constant must exist on BOTH sides
// with the same value, so a cap changed on one side (a daemon-enforced limit
// vs the spawner's request-side validation of the same field) fails here
// instead of drifting silently.

import { describe, expect, test } from 'bun:test';

import * as mirror from '../../../sandbox-runtime/daemon/src/protocol.ts';
import type {
  RunnerdExecEvent as MirrorEvent,
  RunnerdHealth as MirrorHealth,
} from '../../../sandbox-runtime/daemon/src/protocol.ts';
import { isRunnerdExecEvent as isMirroredExecEvent } from '../../../sandbox-runtime/daemon/src/protocol.ts';
import { ID_ALPHABET_RE } from '../wire.ts';
import * as canonical from './runnerd-protocol.ts';
import type {
  RunnerdExecEvent as CanonicalEvent,
  RunnerdHealth as CanonicalHealth,
} from './runnerd-protocol.ts';
import { isRunnerdExecEvent } from './runnerd-protocol.ts';

/** Daemon-local values the mirror carries whose canonical home is elsewhere
 * in the spawner: the id alphabet lives in wire.ts, the workspace mount in
 * the two session launchers (both bind /agent). Pinned below. */
const DAEMON_LOCAL = new Set(['WORKSPACE_ROOT', 'ID_ALPHABET_RE']);

/** Exported runtime constants (numbers, strings, RegExps, frozen arrays) by
 * name — functions and type-only exports are not comparable values. */
function constantsOf(mod: object): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === 'function') continue;
    out.set(name, value instanceof RegExp ? value.toString() : value);
  }
  return out;
}

/** True only when A and B are the same type, not merely assignable. */
type Exactly<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

describe('runnerd protocol mirror', () => {
  const canon = constantsOf(canonical);
  const mirr = constantsOf(mirror);

  test('both declarations accept the canonical replay markers and terminal storage failures', () => {
    const events: CanonicalEvent[] = [
      { t: 'replay-start' },
      { t: 'replay-complete', throughSeq: 42 },
      { t: 'fail', code: 'OUTPUT_LIMIT', message: 'limit' },
      { t: 'fail', code: 'OUTPUT_GAP', message: 'gap' },
      { t: 'fail', code: 'REPLAY_UNAVAILABLE', message: 'unavailable' },
      { t: 'fail', code: 'DISK_FULL', message: 'disk full' },
    ];
    const mirrored: MirrorEvent[] = events;
    const roundTrip: CanonicalEvent[] = mirrored;
    expect(roundTrip).toEqual(events);
  });

  test('both declarations describe the same Docker engine health', () => {
    const readings: CanonicalHealth[] = (
      ['cold', 'running', 'stopped'] as const
    ).map((engine) => ({
      ok: true,
      bootedAtMs: 1,
      lastActivityAtMs: 2,
      liveExecs: 0,
      dockerReady: true,
      docker: { engine, used: engine !== 'cold' },
    }));
    const mirrored: MirrorHealth[] = readings;
    const roundTrip: CanonicalHealth[] = mirrored;
    expect(roundTrip).toEqual(readings);
    // Assignability alone lets either copy drop the optional field; the
    // typecheck fails here unless both declare it identically.
    const sameDocker: Exactly<
      CanonicalHealth['docker'],
      MirrorHealth['docker']
    > = true;
    expect(sameDocker).toBe(true);
  });

  test.each([
    null,
    '0',
    '1',
    '123',
    '001',
    '',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '9007199254740992',
    '1e3',
    ' 2',
  ])('sequence parser agrees for %s', (raw) => {
    const expected =
      raw === null
        ? 0
        : /^[0-9]+$/.test(raw) && Number.isSafeInteger(Number(raw))
          ? Number(raw)
          : null;
    expect(canonical.parseRunnerdSequence(raw)).toBe(expected);
    expect(mirror.parseRunnerdSequence(raw)).toBe(expected);
  });

  test('every canonical constant is mirrored with the same value', () => {
    for (const [name, value] of canon) {
      expect(mirr.has(name)).toBe(true);
      expect(mirr.get(name)).toEqual(value);
    }
  });

  test('the mirror carries no constant the canonical copy lacks', () => {
    const extra = [...mirr.keys()]
      .filter((k) => !canon.has(k) && !DAEMON_LOCAL.has(k))
      .sort();
    expect(extra).toEqual([]);
  });

  test('the daemon-local values match their spawner-side homes', () => {
    expect(mirror.ID_ALPHABET_RE.toString()).toBe(ID_ALPHABET_RE.toString());
    expect(mirror.WORKSPACE_ROOT).toBe('/agent');
  });

  test('both boundaries accept the same complete events and refuse corrupt fields', () => {
    const exit = {
      t: 'exit',
      exitCode: 0,
      durationMs: 1,
      truncated: { stdout: false, stderr: false },
      timedOut: false,
      cancelled: false,
    };
    const cases: Array<[unknown, boolean]> = [
      [{ t: 'start', execId: 'exec_1', startedAtMs: 1, seq: 1 }, true],
      [{ t: 'stdout', b64: '', seq: 2 }, true],
      [{ t: 'stderr', b64: 'YQ==', extra: 'allowed' }, true],
      [{ t: 'replay-start' }, true],
      [{ t: 'replay-complete', throughSeq: 0 }, true],
      [exit, true],
      [{ t: 'fail', code: 'OUTPUT_LIMIT', message: 'storage full' }, true],
      [{ t: 'fail', code: 'DISK_FULL', message: 'disk full' }, true],
      [null, false],
      [[], false],
      [{ t: 'stdout', b64: 'YQ' }, false],
      [{ t: 'stdout', b64: 'AAAA=' }, false],
      [{ t: 'stdout', b64: '!!==' }, false],
      [{ t: 'stdout', b64: 'YQ==', seq: 0 }, false],
      [{ t: 'stdout', b64: 'YQ==', seq: Number.MAX_SAFE_INTEGER + 1 }, false],
      [{ t: 'start', execId: '', startedAtMs: 1 }, false],
      [{ t: 'start', execId: 'exec', startedAtMs: Infinity }, false],
      [{ t: 'replay-complete', throughSeq: 1.5 }, false],
      [{ t: 'replay-complete', throughSeq: -1 }, false],
      [{ ...exit, truncated: {} }, false],
      [{ ...exit, exitCode: 1.5 }, false],
      [{ ...exit, durationMs: -1 }, false],
      [{ ...exit, durationMs: NaN }, false],
      [{ t: 'fail', code: 'unknown', message: '' }, false],
    ];
    for (const [event, accepted] of cases) {
      expect(isRunnerdExecEvent(event)).toBe(accepted);
      expect(isMirroredExecEvent(event)).toBe(accepted);
    }
  });
});
