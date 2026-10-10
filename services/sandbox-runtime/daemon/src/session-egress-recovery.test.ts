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

/** Run the session's transparent-egress setup against fake `iptables` and
 * `iptables-restore`: `chainExists` answers the REDSOCKS probe, `restoreOk`
 * decides whether the restore commits. Returns every call, in order. */
function installSessionNat(scenario: {
  chainExists: boolean;
  restoreOk: boolean;
  /** The session resolves through Docker's embedded resolver (127.0.0.11),
   * which the DNS DNAT is gated on. */
  embeddedResolver?: boolean;
}) {
  const resolver = fresh('resolv.conf');
  writeFileSync(
    resolver,
    scenario.embeddedResolver === true
      ? 'nameserver 127.0.0.11\noptions ndots:0\n'
      : 'nameserver 10.0.0.2\n',
  );
  const calls = fresh('iptables-calls');
  const restored = fresh('restore-input');
  const iptables = fresh('iptables');
  writeFileSync(
    iptables,
    [
      '#!/bin/sh',
      `printf 'iptables %s\\n' "$*" >> '${calls}'`,
      // The REDSOCKS probes (-S, -L) and every -C check answer from the
      // scenario; additions succeed.
      'case "$*" in',
      `  *" -S REDSOCKS"|*" -L REDSOCKS") ${scenario.chainExists ? 'exit 0' : 'exit 1'} ;;`,
      '  *" -C "*) exit 1 ;;',
      'esac',
      'exit 0',
    ].join('\n'),
  );
  chmodSync(iptables, 0o755);
  const restore = fresh('iptables-restore');
  writeFileSync(
    restore,
    [
      '#!/bin/sh',
      `printf 'iptables-restore %s\\n' "$*" >> '${calls}'`,
      `cat > '${restored}'`,
      scenario.restoreOk ? 'exit 0' : 'exit 2',
    ].join('\n'),
  );
  chmodSync(restore, 0o755);
  const script = [
    helpers,
    `_IPTABLES='${iptables}'`,
    `_IPTABLES_RESTORE='${restore}'`,
    `_RESOLV_CONF='${resolver}'`,
    `TALE_REDSOCKS_UID=10002`,
    // The parts of the setup outside the nat table are not under test.
    `resolve_egress_endpoint() { TALE_EGRESS_IP=10.9.0.5; TALE_EGRESS_PORT=3128; }`,
    `_ensure_default_route() { :; }`,
    `_launch_session_redsocks() { :; }`,
    `setup_session_transparent_egress`,
  ].join('\n');
  const r = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  const read = (path: string) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return '';
    }
  };
  return {
    status: r.status,
    stderr: r.stderr,
    calls: read(calls).trim().split('\n').filter(Boolean),
    restored: read(restored),
  };
}

describe("the session's nat rules", () => {
  test('a fresh namespace gets them in one iptables-restore transaction', () => {
    const r = installSessionNat({ chainExists: false, restoreOk: true });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([
      'iptables -t nat -S REDSOCKS',
      'iptables-restore --noflush',
    ]);
    // The per-rule path's order: the proxy's RETURN at the top of REDSOCKS,
    // then OUTPUT's owner RETURN and its jump.
    expect(r.restored.split('\n').filter(Boolean)).toEqual([
      '*nat',
      ':REDSOCKS - [0:0]',
      '-A REDSOCKS -d 10.9.0.5 -p tcp -j RETURN',
      '-A REDSOCKS -d 0.0.0.0/8 -j RETURN',
      '-A REDSOCKS -d 10.0.0.0/8 -j RETURN',
      '-A REDSOCKS -d 100.64.0.0/10 -j RETURN',
      '-A REDSOCKS -d 127.0.0.0/8 -j RETURN',
      '-A REDSOCKS -d 169.254.0.0/16 -j RETURN',
      '-A REDSOCKS -d 172.16.0.0/12 -j RETURN',
      '-A REDSOCKS -d 192.168.0.0/16 -j RETURN',
      '-A REDSOCKS -p tcp -j REDIRECT --to-ports 12346',
      '-A OUTPUT -p tcp -m owner --uid-owner 10002 -j RETURN',
      '-A OUTPUT -p tcp -j REDSOCKS',
      'COMMIT',
    ]);
  });

  test("behind Docker's embedded resolver, the transaction also sends external DNS to the egress proxy", () => {
    const r = installSessionNat({
      chainExists: false,
      restoreOk: true,
      embeddedResolver: true,
    });
    expect(r.calls).toEqual([
      'iptables -t nat -S REDSOCKS',
      'iptables-restore --noflush',
    ]);
    // The per-rule path's order: the DNAT pair after OUTPUT's jump.
    expect(r.restored.split('\n').filter(Boolean).slice(-4)).toEqual([
      '-A OUTPUT -p tcp -j REDSOCKS',
      '-A OUTPUT -p udp --dport 53 ! -d 127.0.0.11 -j DNAT --to-destination 10.9.0.5:53',
      '-A OUTPUT -p tcp --dport 53 ! -d 127.0.0.11 -j DNAT --to-destination 10.9.0.5:53',
      'COMMIT',
    ]);
  });

  test('an existing chain is completed rule by rule, never restored over', () => {
    const r = installSessionNat({ chainExists: true, restoreOk: true });
    expect(r.status).toBe(0);
    expect(r.calls.some((call) => call.startsWith('iptables-restore'))).toBe(
      false,
    );
    expect(r.calls).toContain(
      'iptables -t nat -I REDSOCKS 1 -d 10.9.0.5 -p tcp -j RETURN',
    );
    expect(r.calls).toContain('iptables -t nat -A OUTPUT -p tcp -j REDSOCKS');
    expect(r.calls).not.toContain('iptables -t nat -N REDSOCKS');
  });

  test('a refused restore falls back to the per-rule path', () => {
    const r = installSessionNat({ chainExists: false, restoreOk: false });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('iptables-restore refused');
    const restoreAt = r.calls.indexOf('iptables-restore --noflush');
    expect(restoreAt).toBeGreaterThan(-1);
    const after = r.calls.slice(restoreAt + 1);
    expect(after).toContain('iptables -t nat -N REDSOCKS');
    expect(after).toContain(
      'iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12346',
    );
    expect(after).toContain('iptables -t nat -A OUTPUT -p tcp -j REDSOCKS');
  });
});
