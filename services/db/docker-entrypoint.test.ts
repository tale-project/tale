// The entrypoint publishes /tmp/.db_ready once this start's init scripts and
// migrations finished, and the healthcheck reads it. /tmp outlives a stop
// (`docker restart` keeps the container's filesystem), so a marker the
// previous start left must be cleared before the server answers, or a restart
// reports ready before its migrations ran.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKER = '/tmp/.db_ready';
const source = readFileSync(
  join(import.meta.dir, 'docker-entrypoint.sh'),
  'utf8',
);

describe('docker-entrypoint.sh ready marker', () => {
  test('the marker is cleared before the background init block that touches it', () => {
    const lines = source.split('\n');
    const code = (line: string) => !line.trimStart().startsWith('#');
    const indexes = (match: (line: string) => boolean) =>
      lines.flatMap((line, i) => (code(line) && match(line) ? [i] : []));

    const clears = indexes((line) => line === `rm -f ${MARKER}`);
    const touches = indexes((line) => line.includes(`touch ${MARKER}`));
    const blockStart = lines.indexOf('(');
    const blockEnd = lines.indexOf(') &', blockStart);

    // One clear, at the top level: not inside a function or the block itself.
    expect(clears).toHaveLength(1);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    expect(touches).toHaveLength(1);
    const [clear = -1] = clears;
    const [touch = -1] = touches;
    expect(clear).toBeLessThan(blockStart);
    expect(touch).toBeGreaterThan(blockStart);
    expect(touch).toBeLessThan(blockEnd);
  });

  // Run the real script with the server and its probe replaced by doubles on
  // PATH. The fake server records whether the marker exists when it starts,
  // then answers the probe and waits for the background block to publish it.
  const root = mkdtempSync(join(tmpdir(), 'tale-db-entrypoint-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test(
    'a restart reports ready only after its own init finished',
    () => {
      const bin = join(root, 'bin');
      const state = join(root, 'state');
      const marker = join(root, 'db_ready');
      mkdirSync(bin);
      mkdirSync(state);
      writeFileSync(
        join(bin, 'pg_isready'),
        '#!/bin/sh\n[ -e "$TALE_DB_TEST_STATE/up" ]\n',
        { mode: 0o755 },
      );
      writeFileSync(
        join(bin, 'postgres-entrypoint.sh'),
        [
          '#!/bin/sh',
          'if [ -e "$TALE_DB_TEST_MARKER" ]; then seen=present; else seen=absent; fi',
          'echo "$seen" > "$TALE_DB_TEST_STATE/marker-at-start"',
          'touch "$TALE_DB_TEST_STATE/up"',
          'i=0',
          'while [ ! -e "$TALE_DB_TEST_MARKER" ] && [ "$i" -lt 200 ]; do',
          '  sleep 0.1',
          '  i=$((i + 1))',
          'done',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      // Redirect the marker and the baked-in config tree into the sandbox.
      const script = join(root, 'docker-entrypoint.sh');
      const rewritten = source
        .replaceAll(MARKER, marker)
        .replaceAll('/etc/postgresql', join(root, 'etc-postgresql'));
      expect(rewritten).not.toContain(MARKER);
      writeFileSync(script, rewritten, { mode: 0o755 });

      const boot = () => {
        rmSync(join(state, 'up'), { force: true });
        rmSync(join(state, 'marker-at-start'), { force: true });
        const run = spawnSync('bash', [script, 'postgres'], {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            DB_PASSWORD: 'not-a-secret',
            TALE_DB_ROLE: 'platform',
            TALE_DB_TEST_STATE: state,
            TALE_DB_TEST_MARKER: marker,
          },
        });
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
        expect(run.stdout).toContain('Database ready.');
        return readFileSync(join(state, 'marker-at-start'), 'utf8').trim();
      };

      // First start: no marker yet, and init publishes it.
      expect(boot()).toBe('absent');
      expect(existsSync(marker)).toBe(true);
      // Restart: the marker of the first start is still on disk, and must be
      // gone before the server answers.
      expect(boot()).toBe('absent');
      expect(existsSync(marker)).toBe(true);
    },
    { timeout: 60_000 },
  );
});
