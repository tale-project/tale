// The runtime image's entrypoint dispatches on ONE positional arg: `daemon`
// (a session) or `egress-sidecar` (the K8s redsocks sidecar). The former
// per-call language lane (`python <packages.json> <options.json> <entry>`)
// has no producer any more; the tail of the script must fail CLOSED on any
// other argv instead of falling through to an install/run of whatever
// arrived. Runs the real script under sh — nothing before the dispatch has a
// side effect, so this is hermetic on any host.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

describe('session environment', () => {
  test('every session execs runnerd with a persistent, writable Node compile cache', () => {
    const root = mkdtempSync(join(tmpdir(), 'tale-entrypoint-env-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      // tini is the last thing the plain dispatch execs; report what runnerd
      // would inherit instead of starting it.
      writeFileSync(
        join(bin, 'tini'),
        '#!/bin/sh\nprintf "CACHE=%s\\n" "$NODE_COMPILE_CACHE"\n[ -d "$NODE_COMPILE_CACHE" ] && [ -w "$NODE_COMPILE_CACHE" ] && printf "WRITABLE\\n"\ncase "$NODE_COMPILE_CACHE" in "$TMPDIR"/*) printf "UNDER_TMPDIR\\n" ;; esac\n',
        { mode: 0o755 },
      );
      const script = join(root, 'entrypoint.sh');
      writeFileSync(
        script,
        readFileSync(ENTRYPOINT, 'utf8').replaceAll(
          '/agent/',
          `${root}/agent/`,
        ),
      );
      const r = spawnSync('sh', [script, 'daemon'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
      });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(
        `CACHE=${root}/agent/.runtime/home/.cache/node-compile-cache\nWRITABLE\n`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the root Docker supervisor never loads the agent-writable compile cache', () => {
    const source = readFileSync(ENTRYPOINT, 'utf8');
    const exec = source.slice(
      source.indexOf('exec /usr/bin/env -u NODE_OPTIONS'),
      source.indexOf('lazy-docker.mjs'),
    );
    expect(exec).toContain('-u NODE_COMPILE_CACHE');
    expect(source).toContain(
      'export TALE_RUNNER_NODE_COMPILE_CACHE="$NODE_COMPILE_CACHE"',
    );
  });
});
