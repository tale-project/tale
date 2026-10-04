import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('a hung docker info and its descendants are killed within the total readiness deadline', () => {
  const root = mkdtempSync(join(tmpdir(), 'docker-readiness-'));
  const python = Bun.which('python3');
  if (!python) throw new Error('Python 3 is required');
  const source = readFileSync(
    resolve(import.meta.dir, '../../entrypoint.sh'),
    'utf8',
  );
  const functionStart = source.indexOf('wait_inner_dockerd() {');
  const start = source.indexOf("<<'PY'\n", functionStart) + "<<'PY'\n".length;
  const script = source.slice(start, source.indexOf('\nPY', start));
  writeFileSync(
    join(root, 'docker'),
    '#!/bin/sh\nsleep 30 &\nchild=$!\nprintf "%s %s\\n" "$$" "$child" >> "$TALE_PROBE_TEST_PID"\nwait\n',
    { mode: 0o755 },
  );
  try {
    const began = Date.now();
    const result = spawnSync(
      python,
      [
        '-I',
        '-',
        String(process.pid),
        join(root, 'docker'),
        '1.2',
        '/var/run/tale-docker/engine.sock',
      ],
      {
        input: script,
        encoding: 'utf8',
        timeout: 3_000,
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          TALE_PROBE_TEST_PID: join(root, 'pid'),
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(Date.now() - began).toBeLessThan(2_500);
    const probes = readFileSync(join(root, 'pid'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split(' ').map(Number));
    for (const [probe, child] of probes) {
      expect(() => process.kill(probe ?? 0, 0)).toThrow();
      // An init may briefly retain a killed orphan as a zombie. It must not
      // remain runnable after its probe's whole process group was killed.
      const state = spawnSync('ps', ['-o', 'stat=', '-p', String(child)], {
        encoding: 'utf8',
      }).stdout.trim();
      expect(state === '' || state.startsWith('Z')).toBe(true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
