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

// PostgreSQL's dynamic shared memory lives in /dev/shm. Docker sizes it on the
// container (compose's shm_size) and never sets TALE_SHM_SIZE; the Incus
// runtime cannot, so it names the size and the entrypoint mounts a tmpfs of it
// while still root. Run the real function against `id` and `mount` doubles.
describe('docker-entrypoint.sh /dev/shm size', () => {
  const root = mkdtempSync(join(tmpdir(), 'tale-db-shm-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const fn = /^mount_shm\(\) \{$[\s\S]*?^\}$/m.exec(source)?.[0];

  function run(env: Record<string, string>, uid = '0', mountExit = 0) {
    expect(fn).toBeDefined();
    const bin = mkdtempSync(join(root, 'bin-'));
    const log = join(bin, 'calls');
    writeFileSync(log, '');
    writeFileSync(join(bin, 'id'), `#!/bin/sh\necho ${uid}\n`, {
      mode: 0o755,
    });
    writeFileSync(
      join(bin, 'mount'),
      `#!/bin/sh\necho "mount $*" >> "${log}"\nexit ${mountExit}\n`,
      { mode: 0o755 },
    );
    const result = spawnSync('bash', ['-c', `set -e\n${fn}\nmount_shm`], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
    });
    return { ...result, calls: readFileSync(log, 'utf8').trim() };
  }

  test('the entrypoint calls it once, before PostgreSQL starts', () => {
    const lines = source.split('\n');
    const calls = lines.flatMap((line, i) => (line === 'mount_shm' ? [i] : []));
    const start = lines.findIndex((line) =>
      line.startsWith('exec postgres-entrypoint.sh '),
    );
    expect(calls).toHaveLength(1);
    expect(start).toBeGreaterThan(-1);
    expect(calls[0]).toBeLessThan(start);
  });

  test('does nothing when TALE_SHM_SIZE is unset, as on Docker', () => {
    const { status, calls, stderr } = run({});
    expect(status).toBe(0);
    expect(calls).toBe('');
    expect(stderr).toBe('');
  });

  test('mounts a tmpfs of the named size while root', () => {
    const { status, calls, stdout } = run({ TALE_SHM_SIZE: '256m' });
    expect(status).toBe(0);
    expect(calls).toBe(
      'mount -t tmpfs -o size=256m,mode=1777,nosuid,nodev,noexec tmpfs /dev/shm',
    );
    expect(stdout).toContain('/dev/shm is a tmpfs of 256m');
  });

  test.each(['lots', '0', '256 m', '-1m', '1t'])(
    'keeps /dev/shm and warns on a value that is no size (%p)',
    (size) => {
      const { status, calls, stderr } = run({ TALE_SHM_SIZE: size });
      expect(status).toBe(0);
      expect(calls).toBe('');
      expect(stderr).toContain('is not a size');
    },
  );

  test('keeps /dev/shm and warns when not root', () => {
    const { status, calls, stderr } = run({ TALE_SHM_SIZE: '256m' }, '999');
    expect(status).toBe(0);
    expect(calls).toBe('');
    expect(stderr).toContain('not root');
  });

  test('a failed mount warns and never stops the start', () => {
    const { status, stderr } = run({ TALE_SHM_SIZE: '256m' }, '0', 32);
    expect(status).toBe(0);
    expect(stderr).toContain('could not mount');
  });
});

// DB_PROFILE sizes the server, and each DB_ variable still wins over it. The
// section that turns both into the server's arguments is run on its own.
describe('docker-entrypoint.sh database profile', () => {
  const heading = (title: string) => {
    const at = source.indexOf(`# ${title}`);
    expect(at, title).toBeGreaterThan(-1);
    // Back to the rule line above the heading.
    return source.lastIndexOf('\n# ====', at) + 1;
  };
  const section = source.slice(
    heading('The profile: what the server is sized for'),
    heading('Print configuration info (for debugging)'),
  );

  function settings(env: Record<string, string>) {
    const result = spawnSync(
      'bash',
      ['-c', `set -e\n${section}\nprintf '%s\\n' "\${POSTGRES_ARGS[@]}"`],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } },
    );
    const lines = result.stdout.split('\n').filter((line) => line !== '');
    // Every setting is its own `-c name=value` pair.
    const flags = lines.filter((_, index) => index % 2 === 0);
    const values = lines.filter((_, index) => index % 2 === 1);
    return {
      status: result.status,
      stderr: result.stderr,
      flags,
      values: Object.fromEntries(
        values.map((pair) => {
          const at = pair.indexOf('=');
          return [pair.slice(0, at), pair.slice(at + 1)];
        }),
      ),
    };
  }
  const CONFIG = { config_file: '/etc/postgresql/postgresql.conf' };
  const SMALL = {
    max_connections: '40',
    shared_buffers: '32MB',
    effective_cache_size: '256MB',
    maintenance_work_mem: '32MB',
    work_mem: '4MB',
    autovacuum_max_workers: '1',
    max_parallel_workers_per_gather: '0',
    max_parallel_maintenance_workers: '0',
    max_parallel_workers: '0',
    'pg_stat_statements.max': '1000',
  };

  test.each([{}, { DB_PROFILE: 'standard' }, { DB_PROFILE: '' }])(
    'no profile, or the standard one, leaves every size to postgresql.conf (%j)',
    (env) => {
      const { status, stderr, values } = settings(env);
      expect(stderr).toBe('');
      expect(status).toBe(0);
      expect(values).toEqual(CONFIG);
    },
  );

  test('the small profile sizes the server for a host it shares', () => {
    const { status, stderr, values, flags } = settings({ DB_PROFILE: 'small' });
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(values).toEqual({ ...SMALL, ...CONFIG });
    expect(new Set(flags)).toEqual(new Set(['-c']));
  });

  test('a size the operator names wins over the profile', () => {
    expect(
      settings({
        DB_PROFILE: 'small',
        DB_SHARED_BUFFERS: '1GB',
        DB_MAX_CONNECTIONS: '200',
      }).values,
    ).toEqual({
      ...SMALL,
      shared_buffers: '1GB',
      max_connections: '200',
      ...CONFIG,
    });
    // Each of the five, not only the two above.
    expect(
      settings({
        DB_PROFILE: 'small',
        DB_MAX_CONNECTIONS: '120',
        DB_SHARED_BUFFERS: '512MB',
        DB_EFFECTIVE_CACHE_SIZE: '2GB',
        DB_MAINTENANCE_WORK_MEM: '256MB',
        DB_WORK_MEM: '16MB',
      }).values,
    ).toEqual({
      ...SMALL,
      max_connections: '120',
      shared_buffers: '512MB',
      effective_cache_size: '2GB',
      maintenance_work_mem: '256MB',
      work_mem: '16MB',
      ...CONFIG,
    });
    // And without a profile it is the one thing that changes.
    expect(settings({ DB_WORK_MEM: '64MB' }).values).toEqual({
      work_mem: '64MB',
      ...CONFIG,
    });
  });

  test.each(['tiny', 'Small', 'small ', '0'])(
    'refuses a profile it does not know, before anything starts (%p)',
    (profile) => {
      const { status, stderr, values } = settings({ DB_PROFILE: profile });
      expect(status).toBe(1);
      expect(stderr).toBe(
        `ERROR: DB_PROFILE must be small or standard; got: ${profile}\n`,
      );
      expect(values).toEqual({});
    },
  );

  test('the refusal comes before the server and its init are started', () => {
    const lines = source.split('\n');
    const refusal = lines.findIndex((line) =>
      line.includes('DB_PROFILE must be small or standard'),
    );
    const background = lines.indexOf('(');
    const start = lines.findIndex((line) =>
      line.startsWith('exec postgres-entrypoint.sh '),
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(background);
    expect(refusal).toBeLessThan(start);
  });

  // A size the image set in ENV would read as the operator's, and the
  // profile could never apply.
  test('the image names none of the sizes a profile sets', () => {
    const dockerfile = readFileSync(join(import.meta.dir, 'Dockerfile'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    for (const name of [
      'DB_MAX_CONNECTIONS',
      'DB_SHARED_BUFFERS',
      'DB_EFFECTIVE_CACHE_SIZE',
      'DB_MAINTENANCE_WORK_MEM',
      'DB_WORK_MEM',
      'DB_PROFILE',
    ])
      expect(dockerfile, name).not.toMatch(new RegExp(`\\b${name}=`));
  });

  // The standard sizes are postgresql.conf's, which the start banner repeats.
  test('the banner names the sizes postgresql.conf holds', () => {
    const conf = readFileSync(join(import.meta.dir, 'postgresql.conf'), 'utf8');
    const held = (name: string) =>
      new RegExp(`^${name}\\s*=\\s*(\\S+)`, 'm').exec(conf)?.[1];
    for (const [variable, name] of [
      ['DB_SHARED_BUFFERS', 'shared_buffers'],
      ['DB_EFFECTIVE_CACHE_SIZE', 'effective_cache_size'],
      ['DB_WORK_MEM', 'work_mem'],
      ['DB_MAINTENANCE_WORK_MEM', 'maintenance_work_mem'],
    ] as const) {
      const value = held(name);
      expect(value, name).toBeDefined();
      expect(source).toContain(`\${${variable}:-${value}}`);
    }
    // PostgreSQL's own default, which the file does not repeat.
    expect(held('max_connections')).toBeUndefined();
    expect(source).toContain('${DB_MAX_CONNECTIONS:-100}');
  });
});
