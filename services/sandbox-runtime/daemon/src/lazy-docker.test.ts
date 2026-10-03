// Exercise the production Node transport, not Bun's different net.Socket implementation.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Docker activation lifecycle and streams under Node', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tale-lazy-node-'));
  try {
    const bundle = await Bun.build({
      entrypoints: [join(import.meta.dir, 'lazy-docker.node-fixture.ts')],
      target: 'node',
      outdir: dir,
    });
    expect(bundle.success).toBe(true);
    const result = spawnSync(
      'node',
      [
        '--test',
        '--test-reporter=tap',
        join(dir, 'lazy-docker.node-fixture.js'),
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
      },
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('# tests 7');
    expect(result.stdout).toContain('# pass 7');
    expect(result.status).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 25_000);
