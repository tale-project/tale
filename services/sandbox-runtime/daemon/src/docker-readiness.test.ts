import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('a hung docker info is killed within the total readiness deadline', () => {
  const root = mkdtempSync(join(tmpdir(), 'docker-readiness-'));
  const python = Bun.which('python3');
  if (!python) throw new Error('Python 3 is required');
  const source = readFileSync(
    resolve(import.meta.dir, '../../entrypoint.sh'),
    'utf8',
  );
  const start = source.indexOf("<<'PYREADY'\n") + "<<'PYREADY'\n".length;
  const script = source
    .slice(start, source.indexOf('\nPYREADY', start))
    .replace('time.monotonic() + 30', 'time.monotonic() + 1.2');
  writeFileSync(
    join(root, 'docker'),
    '#!/bin/sh\nprintf "%s" "$$" > "$TALE_PROBE_TEST_PID"\nexec sleep 30\n',
    { mode: 0o755 },
  );
  try {
    const began = Date.now();
    const result = spawnSync(python, ['-Es', '-', String(process.pid)], {
      input: script,
      encoding: 'utf8',
      timeout: 3_000,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        TALE_PROBE_TEST_PID: join(root, 'pid'),
      },
    });
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(Date.now() - began).toBeLessThan(2_500);
    const probe = Number(readFileSync(join(root, 'pid'), 'utf8'));
    expect(() => process.kill(probe, 0)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
