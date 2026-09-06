// The runtime image's entrypoint dispatches on ONE positional arg: `daemon`
// (a session) or `egress-sidecar` (the K8s redsocks sidecar). The former
// per-call language lane (`python <packages.json> <options.json> <entry>`)
// has no producer any more; the tail of the script must fail CLOSED on any
// other argv instead of falling through to an install/run of whatever
// arrived. Runs the real script under sh — nothing before the dispatch has a
// side effect, so this is hermetic on any host.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ENTRYPOINT = resolve(import.meta.dir, '../../entrypoint.sh');

function run(args: string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync('sh', [ENTRYPOINT, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('entrypoint dispatch', () => {
  test('the retired language lane exits 65 and installs nothing', () => {
    const r = run([
      'python',
      '/agent/code/packages.json',
      '/agent/code/options.json',
      'main.py',
    ]);
    expect(r.status).toBe(65);
    expect(r.stderr).toContain('unknown dispatch arg: python');
    expect(r.stdout).not.toContain('PHASE:');
    expect(r.stdout).toBe('');
  });

  test('every non-dispatch argv fails closed, including none at all', () => {
    for (const args of [
      [],
      ['node'],
      ['bash', 'x'],
      ['polyglot', 'a', 'b', 'c'],
    ]) {
      const r = run(args);
      expect(r.status).toBe(65);
      expect(r.stderr).toContain('unknown dispatch arg:');
      expect(r.stderr).toContain("expected 'daemon' or 'egress-sidecar'");
    }
    expect(run([]).stderr).toContain('unknown dispatch arg: <none>');
  });
});
