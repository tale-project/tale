// Exercise the production Node transport, not Bun's different net.Socket implementation.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('Docker activation lifecycle and streams under Node', async () => {
  // Node resolves the executed file's real path. Canonicalize the fixture too so
  // macOS /var -> /private/var cannot hide accidental bundled entrypoint code.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tale-lazy-node-')));
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

test('the production bundle explicitly starts the root supervisor', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'tale-lazy-entry-')));
  try {
    const bundle = await Bun.build({
      entrypoints: [join(import.meta.dir, 'lazy-docker-entry.ts')],
      target: 'node',
      outdir: dir,
    });
    expect(bundle.success).toBe(true);
    // Exercise the real executable boundary without creating privileged sockets,
    // including when the test itself runs as root in a container.
    const result = spawnSync(
      'node',
      [
        '--input-type=module',
        '--eval',
        'process.getuid = () => 10001; await import(process.argv[1]);',
        pathToFileURL(join(dir, 'lazy-docker-entry.js')).href,
      ],
      { encoding: 'utf8', timeout: 5_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      '[lazy-docker] supervisor failed: Docker supervisor requires root\n',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
