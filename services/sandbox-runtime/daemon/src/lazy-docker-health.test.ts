import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('non-activating Docker health under production Node', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tale-health-node-'));
  try {
    const bundle = await Bun.build({
      entrypoints: [
        join(import.meta.dir, 'lazy-docker-health.node-fixture.ts'),
      ],
      target: 'node',
      outdir: dir,
    });
    expect(bundle.success).toBe(true);
    const result = spawnSync(
      'node',
      [
        '--test',
        '--test-reporter=tap',
        join(dir, 'lazy-docker-health.node-fixture.js'),
      ],
      {
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('# tests 12');
    expect(result.stdout).toContain('# pass 12');
    expect(result.status).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
