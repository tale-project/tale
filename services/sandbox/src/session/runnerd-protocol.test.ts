// The runnerd wire protocol exists twice on purpose: this workspace's
// runnerd-protocol.ts is the canonical copy and the daemon's
// services/sandbox-runtime/daemon/src/protocol.ts is a hand-kept mirror (the
// daemon is bundled into the runtime image and cannot import across the
// service boundary). Each side consumes a different subset, so knip excludes
// both from the dead-export sweep — which means nothing else keeps them
// aligned. This test does: every exported constant must exist on BOTH sides
// with the same value, so a cap changed on one side (a daemon-enforced limit
// vs the spawner's request-side validation of the same field) fails here
// instead of drifting silently.

import { describe, expect, test } from 'bun:test';

import * as mirror from '../../../sandbox-runtime/daemon/src/protocol.ts';
import { ID_ALPHABET_RE } from '../wire.ts';
import * as canonical from './runnerd-protocol.ts';

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

describe('runnerd protocol mirror', () => {
  const canon = constantsOf(canonical);
  const mirr = constantsOf(mirror);

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
});
