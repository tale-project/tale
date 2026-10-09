// The real entrypoint helpers that keep a session's transparent egress up:
// the egress name is asked again for a few seconds before the session gives up
// on it, and redsocks is restarted when it exits. Runs the script's helper
// section under sh with fake tools; nothing touches the host's network.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entrypoint = readFileSync(
  resolve(import.meta.dir, '../../entrypoint.sh'),
  'utf8',
);
const helpers = entrypoint.slice(
  0,
  entrypoint.indexOf('# K8s transparent-egress native sidecar.'),
);
const scratch = mkdtempSync(join(tmpdir(), 'tale-session-egress-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let sequence = 0;
const fresh = (name: string) => join(scratch, `${name}-${++sequence}`);

/** Run the helpers with `getent` answering from its `answerFrom`th call on
 * (0: never) and `sleep` recorded instead of waited. */
function resolveProxy(answerFrom: number) {
  const calls = fresh('getent-calls');
  const sleeps = fresh('sleeps');
  const script = [
    helpers,
    `getent() {`,
    `  n=$(cat '${calls}' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${calls}'`,
    `  [ ${answerFrom} -gt 0 ] && [ "$n" -ge ${answerFrom} ] && printf '10.9.0.5 sandbox-egress\\n'`,
    `  return 0`,
    `}`,
    `sleep() { echo "$1" >> '${sleeps}'; }`,
    `_proxy_to_ip http://sandbox-egress:3128`,
  ].join('\n');
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  const read = (path: string) => {
    try {
      return readFileSync(path, 'utf8').trim();
    } catch {
      return '';
    }
  };
  return {
    status: r.status,
    stdout: r.stdout,
    calls: Number(read(calls) || 0),
    sleeps: read(sleeps).split('\n').filter(Boolean).map(Number),
  };
}

describe('resolving the egress proxy at session boot', () => {
  test('uses the first answer without waiting', () => {
    const r = resolveProxy(1);
    expect(r.stdout).toBe('http://10.9.0.5:3128');
    expect(r.calls).toBe(1);
    expect(r.sleeps).toEqual([]);
  });

  test('asks again while the name does not resolve yet', () => {
    const r = resolveProxy(3);
    expect(r.stdout).toBe('http://10.9.0.5:3128');
    expect(r.calls).toBe(3);
    expect(r.sleeps).toEqual([1, 2]);
  });

  test('gives up after a bounded wait and keeps the name', () => {
    const r = resolveProxy(0);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('http://sandbox-egress:3128');
    expect(r.calls).toBe(4);
    expect(r.sleeps.reduce((sum, s) => sum + s, 0)).toBeLessThanOrEqual(5);
  });
});

describe('the session redsocks', () => {
  test('is started again after it exits', async () => {
    const runs = fresh('redsocks-runs');
    const redsocks = fresh('redsocks');
    // A redsocks that exits at once, as a crash would.
    writeFileSync(
      redsocks,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${runs}'\nexit 1\n`,
    );
    chmodSync(redsocks, 0o755);
    // setpriv execs its command, so the background job IS the supervisor.
    const bin = fresh('bin');
    mkdirSync(bin);
    const setpriv = join(bin, 'setpriv');
    writeFileSync(
      setpriv,
      '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n',
    );
    chmodSync(setpriv, 0o755);
    const conf = fresh('redsocks.conf');
    const script = [
      helpers,
      `_REDSOCKS='${redsocks}'`,
      `TALE_REDSOCKS_CONF='${conf}'`,
      `TALE_REDSOCKS_UID=10002`,
      `TALE_EGRESS_IP=10.9.0.5`,
      `TALE_EGRESS_PORT=3128`,
      `_launch_session_redsocks`,
      `echo "$!"`,
      // The supervisor outlives this shell, as it outlives the entrypoint.
    ].join('\n');
    const shell = spawn('sh', ['-c', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    });
    let out = '';
    shell.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    await new Promise((done) => shell.on('close', done));
    const supervisor = Number(out.trim());
    expect(Number.isInteger(supervisor) && supervisor > 0).toBe(true);
    try {
      const deadline = Date.now() + 10_000;
      let started: string[] = [];
      while (Date.now() < deadline) {
        try {
          started = readFileSync(runs, 'utf8').trim().split('\n');
        } catch {
          started = [];
        }
        if (started.length >= 2) break;
        await Bun.sleep(100);
      }
      expect(started.length).toBeGreaterThanOrEqual(2);
      expect(started[0]).toBe(`-c ${conf}`);
    } finally {
      process.kill(supervisor, 'SIGTERM');
    }
  });
});
