// The session contract, step by step, against the real node: create (cold),
// exec, files, env, the limits and hardening the instance got, the workspace
// across stop and resume, a duplicate and a race, a pin, a render session, and
// destroy. Each step names what a platform call would see and what the node
// holds afterwards.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
  label,
} from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  lab,
  reportFor,
  sessionId,
  sessionInstance,
  sessionVolume,
  sh,
  spawnerOf,
  step,
  until,
} from '../harness.ts';
import { field, type Reply } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';
import { asText } from '../util.ts';

const ORG = 'e2e-org';
const report = reportFor('lifecycle');
const spawner = spawnerOf({
  name: 'lifecycle',
  port: 18003,
  token: newToken(),
});
const api = spawner.api;

const S1 = sessionId('life');
const RACE = sessionId('race');
const RENDER = sessionId('render');

let created: { createdAtMs: number; instanceName: string } | undefined;

function created1() {
  if (created === undefined) {
    throw new Error('the cold create did not succeed: nothing below can run');
  }
  return created;
}

describe('a session on a real Incus node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    const started = performance.now();
    const health = await spawner.ready({ image: true });
    report.add(
      'boot, pull the runtime image from the registry and unpack it',
      performance.now() - started,
      `runtime image ${String(field(health, 'runtimeImage', 'state'))}`,
    );
    report.fact('health', String(field(health, 'dockerServerVersion')));
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('health names the Incus node and the project', async () => {
    const reply = await api.health();
    expectStatus(reply, 200, 'GET /health');
    expect(field(reply.json, 'status')).toBe('ok');
    expect(String(field(reply.json, 'dockerServerVersion'))).toMatch(
      new RegExp(`^incus [0-9]+\\.[0-9]+.* project=${lab.project}`),
    );
    expect(field(reply.json, 'runtimeImage', 'state')).toBe('ready');
  });

  step('limits and capacity describe the project', async () => {
    const limits = await api.limits(ORG);
    expectStatus(limits, 200, 'GET /v1/limits');
    expect(field(limits.json, 'maxSessions')).toBe(6);
    const capacity = await api.capacity(ORG);
    expectStatus(capacity, 200, 'GET /v1/capacity');
    expect(field(capacity.json, 'backend')).toBe('incus');
    expect(field(capacity.json, 'scope')).toBe('project');
    expect(field(capacity.json, 'sessions', 'limit')).toBe(6);
    expect(field(capacity.json, 'sessions', 'running')).toBe(0);
    // A restricted certificate does not see the node's CPU and memory.
    expect(field(capacity.json, 'resources', 'cpu', 'totalCores')).toBeNull();
  });

  step('a cold create answers 201 with the session', async () => {
    const result = await api.create({
      sessionId: S1,
      organizationId: ORG,
      profile: 'agent',
      ttlMs: 3_600_000,
      idleTimeoutMs: 1_800_000,
    });
    expectStatus(result.reply, 201, 'POST /v1/sessions');
    const session = result.session;
    if (session === undefined) throw new Error('no session in the 201');
    report.add(
      'cold create (instance, DHCP, entrypoint, runnerd ready)',
      result.elapsedMs,
      `${result.imageWaits} wait(s) on the image`,
    );
    expect(session.backend).toBe('incus');
    expect(session.state).toBe('ready');
    expect(session.profile).toBe('agent');
    expect(session.pinned).toBe(false);
    created = {
      createdAtMs: session.createdAtMs,
      instanceName: incusInstanceName(S1),
    };
  });

  step('the instance is what the contract says', async () => {
    const { createdAtMs, instanceName } = created1();
    const instance = await sessionInstance(S1);
    if (instance === undefined) throw new Error('no instance for the session');
    expect(instance.name).toBe(instanceName);
    expect(instance.status).toBe('Running');
    expect(instance.ephemeral).toBe(false);
    const config = instance.config;
    expect(label(config, LABEL.sandboxSession)).toBe('1');
    expect(label(config, LABEL.session)).toBe(S1);
    expect(label(config, LABEL.organization)).toBe(ORG);
    expect(label(config, LABEL.profile)).toBe('agent');
    expect(label(config, LABEL.created)).toBe(String(createdAtMs));
    expect(config['security.idmap.isolated']).toBe('true');
    expect(config['security.guestapi']).toBe('false');
    expect(config['boot.autostart']).toBe('false');
    expect(config['limits.memory']).toBe('4GiB');
    expect(config['limits.processes']).toBe('512');
    expect(config['limits.cpu.allowance']).toBe('200ms/100ms');
    expect(config['oci.entrypoint']).toBe(
      '/usr/bin/setpriv --no-new-privs -- /docker-entrypoint.sh daemon',
    );
    expect(config['oci.uid']).toBeDefined();
    // Nothing a restricted project refuses was asked for.
    expect(Object.keys(config).filter((key) => key.startsWith('raw.'))).toEqual(
      [],
    );
    expect(config['limits.memory.swap']).toBeUndefined();
    // The workspace is the one device of the instance; the root disk and the
    // NIC belong to the profile. (There is no tmpfs device for /dev/shm: a
    // restricted project admits pool-backed disks only.)
    expect(instance.devices).toEqual({
      workspace: {
        type: 'disk',
        pool: lab.pool,
        source: incusWorkspaceVolumeName(S1),
        path: '/agent',
      },
    });
    expect(instance.profiles).toContain(lab.profile);
    // One address, on the sandbox bridge.
    expect(instance.addresses).toHaveLength(1);
    expect(instance.addresses[0]?.startsWith('10.20.0.')).toBe(true);
    report.fact('session address', instance.addresses[0] ?? '?');
  });

  step(
    "/dev/shm is the profile's size, mounted by the entrypoint",
    async () => {
      const { instanceName } = created1();
      const shm = await sh(
        api,
        S1,
        'df -m /dev/shm | tail -n 1; grep " /dev/shm " /proc/mounts',
      );
      report.fact('/dev/shm in a session', shm.trim().replaceAll('\n', ' | '));
      // 512m, the agent profile's SANDBOX_AGENT_SHM_SIZE, not the image's 64 MiB.
      expect(shm).toMatch(/\s512\s/);
      expect(shm).toMatch(/ \/dev\/shm tmpfs rw,nosuid,nodev,noexec/);
      expect(await admin.consoleLog(instanceName)).toContain(
        '/dev/shm is a tmpfs of 512m',
      );
    },
  );

  step('the workspace volume has its quota, shift and owner', async () => {
    const volume = await sessionVolume(S1);
    if (volume === undefined) throw new Error('no workspace volume');
    expect(volume.config.size).toBe('512MiB');
    expect(volume.config['security.shifted']).toBe('true');
    expect(volume.config['initial.uid']).toBe('10001');
    expect(volume.config['initial.gid']).toBe('10001');
    expect(label(volume.config, LABEL.workspace)).toBe('1');
    expect(label(volume.config, LABEL.organization)).toBe(ORG);
    expect(
      volume.usedBy.some((url) => url.includes(created1().instanceName)),
    ).toBe(true);
  });

  step('exec carries output, exit codes, env, cwd and stdin', async () => {
    const failed = await api.exec(S1, {
      shell: 'echo out; echo err >&2; exit 3',
    });
    expect(failed.result?.status).toBe('failed');
    expect(failed.result?.exitCode).toBe(3);
    expect(failed.stdout).toBe('out\n');
    expect(failed.stderr).toBe('err\n');

    const identity = await sh(
      api,
      S1,
      'id -u; id -g; pwd; echo "$HOME"; echo "$HTTPS_PROXY"; echo "$NO_PROXY"',
    );
    const lines = identity.trim().split('\n');
    expect(lines[0]).toBe('10001');
    expect(lines[1]).toBe('10001');
    expect(lines[2]).toBe('/agent');
    expect(lines[3]).toBe('/agent/.runtime/home');
    expect(lines[4]).toBe(lab.egressProxy);
    expect(lines[5]).toContain('sandbox-llm-gateway');

    const withEnv = await api.exec(S1, {
      command: ['/bin/sh', '-c', 'echo "$E2E_VALUE"; pwd'],
      env: { E2E_VALUE: 'from the request' },
      cwd: '/agent/workspace',
    });
    expect(withEnv.result?.status).toBe('completed');
    expect(withEnv.stdout).toBe('from the request\n/agent/workspace\n');
    // A working directory outside the workspace is refused, not run.
    const outside = await api.exec(S1, { shell: 'pwd', cwd: '/tmp' });
    expect(outside.result?.errorCode).toBe('INVALID_CWD');

    const echoed = await api.exec(S1, { command: ['cat'], stdin: 'to stdin' });
    expect(echoed.result?.status).toBe('completed');
    expect(echoed.stdout).toBe('to stdin');
  });

  step(
    'exec streams while the command runs, and times its round trip',
    async () => {
      const arrivals: number[] = [];
      const slow = await api.exec(S1, {
        shell: 'for i in 1 2 3; do echo tick $i; sleep 1; done',
        onEvent: (event) => {
          if (event.event === 'stdout') arrivals.push(event.atMs);
        },
      });
      expect(slow.result?.status).toBe('completed');
      expect(slow.stdout).toBe('tick 1\ntick 2\ntick 3\n');
      expect(arrivals.length).toBeGreaterThanOrEqual(3);
      // The first line came about two seconds before the stream ended.
      expect((arrivals.at(-1) ?? 0) - (arrivals[0] ?? 0)).toBeGreaterThan(
        1_500,
      );

      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const outcome = await api.exec(S1, { command: ['true'] });
        expect(outcome.result?.status).toBe('completed');
        samples.push(outcome.elapsedMs);
      }
      samples.sort((a, b) => a - b);
      report.add(
        'exec round trip (`true`, median of 5)',
        samples[2] ?? 0,
        `min ${Math.round(samples[0] ?? 0)} ms, max ${Math.round(samples[4] ?? 0)} ms`,
      );
    },
  );

  step('an exec past its deadline is ended; a cancel ends one', async () => {
    const late = await api.exec(S1, { shell: 'sleep 60', timeoutMs: 2_000 });
    expect(late.result?.status).toBe('failed');
    expect(late.result?.errorCode).toBe('TIMEOUT');

    const execId = 'cancel-me';
    const running = api.exec(S1, { execId, shell: 'sleep 60' });
    await until('the exec to run', async () => {
      const reply = await api.call('GET', `/v1/sessions/${S1}/exec/${execId}`);
      return field(reply.json, 'state') === 'running' || undefined;
    });
    const cancelled = await api.cancelExec(S1, execId);
    expectStatus(cancelled, 200, 'cancel');
    expect(field(cancelled.json, 'killed')).toBe(true);
    // The cancel ends the stream that carried the exec (the platform reads the
    // cancel's own answer), and the process with it.
    const outcome = await running;
    expect(outcome.reply.status).toBe(200);
    await until('the exec to have exited', async () => {
      const reply = await api.call('GET', `/v1/sessions/${S1}/exec/${execId}`);
      return field(reply.json, 'state') !== 'running' || undefined;
    });
    // No `sleep` is left: the cancel ended the command and what it started.
    const left = await sh(
      api,
      S1,
      'n=0; for p in /proc/[0-9]*; do [ "$(cat "$p/comm" 2>/dev/null)" = sleep ] && n=$((n+1)); done; echo $n',
    );
    expect(left.trim()).toBe('0');
  });

  step('files are staged, listed, read back and deleted', async () => {
    const binary = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    expectStatus(
      await api.stage(S1, [
        { path: 'e2e/hello.txt', content: 'hello from the platform\n' },
        {
          path: 'e2e/nested/dir/binary.bin',
          contentBase64: binary.toString('base64'),
        },
      ]),
      200,
      'stage',
    );
    const read = await api.readFile(S1, 'e2e/hello.txt');
    expectStatus(read.reply, 200, 'read hello.txt');
    expect(new TextDecoder().decode(read.bytes)).toBe(
      'hello from the platform\n',
    );
    const readBinary = await api.readFile(S1, 'e2e/nested/dir/binary.bin');
    expect(
      Buffer.from(readBinary.bytes ?? new Uint8Array()).equals(binary),
    ).toBe(true);

    const listing = await api.listFiles(S1, 'e2e');
    expectStatus(listing, 200, 'list');
    expect(JSON.stringify(listing.json)).toContain('hello.txt');

    // What the platform wrote is the session user's, and the session sees it.
    expect(
      await sh(api, S1, 'stat -c "%u:%g" e2e/hello.txt; cat e2e/hello.txt'),
    ).toBe('10001:10001\nhello from the platform\n');
    expectStatus(await api.deleteFiles(S1, ['e2e/hello.txt']), 200, 'delete');
    expect((await api.readFile(S1, 'e2e/hello.txt')).reply.status).toBe(404);
    expect((await api.readFile(S1, 'e2e/missing.txt')).reply.status).toBe(404);
  });

  step('a file near the inline limit goes in and out intact', async () => {
    // Inline staging is capped by the request body (SANDBOX max request body,
    // 256 KiB with the base64 and the JSON around it); bigger files come by URL.
    const big = Buffer.alloc(150 * 1024);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff;
    const started = performance.now();
    expectStatus(
      await api.stage(S1, [
        { path: 'e2e/big.bin', contentBase64: big.toString('base64') },
      ]),
      200,
      'stage big.bin',
    );
    const staged = performance.now() - started;
    const readStarted = performance.now();
    const read = await api.readFile(S1, 'e2e/big.bin');
    const readMs = performance.now() - readStarted;
    expect(Buffer.from(read.bytes ?? new Uint8Array()).equals(big)).toBe(true);
    report.add('stage a 150 KiB file', staged);
    report.add('read a 150 KiB file back', readMs);
    expect(
      (
        await sh(api, S1, 'sha256sum < /agent/e2e/big.bin | cut -d" " -f1')
      ).trim(),
    ).toBe(new Bun.CryptoHasher('sha256').update(big).digest('hex'));
  });

  step(
    'a file past the inline limit comes by URL, and arrives intact',
    async () => {
      // Large files travel as a URL runnerd fetches (the platform presigns one):
      // here the node serves it on the address the ACL lets a session reach.
      const big = Buffer.alloc(6 * 1024 * 1024);
      for (let i = 0; i < big.length; i += 1) big[i] = (i * 131 + 17) & 0xff;
      const digest = new Bun.CryptoHasher('sha256').update(big).digest('hex');
      const server = Bun.serve({
        hostname: lab.gatewayAddress,
        port: 8080,
        fetch: () => new Response(big),
      });
      try {
        const started = performance.now();
        expectStatus(
          await api.stage(S1, [
            {
              path: 'e2e/large.bin',
              url: `http://${lab.gatewayAddress}:8080/large.bin`,
              sha256: digest,
            },
          ]),
          200,
          'stage large.bin by URL',
        );
        report.add('stage a 6 MiB file by URL', performance.now() - started);
      } finally {
        await server.stop(true);
      }
      expect(
        (
          await sh(api, S1, 'sha256sum < /agent/e2e/large.bin | cut -d" " -f1')
        ).trim(),
      ).toBe(digest);
      const readStarted = performance.now();
      const read = await api.readFile(S1, 'e2e/large.bin');
      report.add('read a 6 MiB file back', performance.now() - readStarted);
      expect(Buffer.from(read.bytes ?? new Uint8Array()).equals(big)).toBe(
        true,
      );
      await sh(api, S1, 'rm -f /agent/e2e/large.bin');
    },
  );

  step('env set and unset reach the next exec', async () => {
    const patched = await api.patchEnv(S1, { set: { E2E_PATCHED: 'yes' } });
    expectStatus(patched, 200, 'PATCH env');
    expect(await sh(api, S1, 'printenv E2E_PATCHED')).toBe('yes\n');
    expectStatus(
      await api.patchEnv(S1, { unset: ['E2E_PATCHED'] }),
      200,
      'unset',
    );
    const gone = await api.exec(S1, { shell: 'printenv E2E_PATCHED' });
    expect(gone.result?.exitCode).toBe(1);
  });

  step(
    'the session runs unprivileged, in a user namespace of its own',
    async () => {
      const report1 = await sh(
        api,
        S1,
        "grep -E '^(NoNewPrivs|CapEff|Uid):' /proc/self/status; cat /proc/self/uid_map",
      );
      expect(report1).toMatch(/NoNewPrivs:\s+1/);
      expect(report1).toMatch(/CapEff:\s+0000000000000000/);
      expect(report1).toMatch(/Uid:\s+10001\s+10001\s+10001\s+10001/);
      // `0 <host base> <range>`: container root is a high, unshared host id.
      const map = /^\s*0\s+([0-9]+)\s+[0-9]+/m.exec(report1);
      expect(Number(map?.[1] ?? 0)).toBeGreaterThanOrEqual(65536);

      // Everything the entrypoint started carries no_new_privs: runnerd too.
      const runnerd = await sh(
        api,
        S1,
        `for p in /proc/[0-9]*; do
         if tr '\\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q '[r]unnerd'; then
           echo "pid \${p#/proc/}"; grep -E '^(NoNewPrivs|Uid):' "$p/status"
         fi
       done`,
      );
      report.fact('runnerd process', runnerd.replaceAll('\n', ' '));
      expect(runnerd).toContain('NoNewPrivs:\t1');

      // And a setuid binary cannot lift the session user.
      const lifted = await api.exec(S1, {
        shell: 'su -c id root </dev/null; echo rc=$?',
      });
      expect(lifted.stdout).not.toContain('uid=0');
    },
  );

  step('the cgroup limits of the instance are in force', async () => {
    const limits = await sh(
      api,
      S1,
      'cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max /sys/fs/cgroup/pids.max',
    );
    expect(limits.trim().split('\n')).toEqual([
      String(4 * 1024 ** 3),
      '200000 100000',
      '512',
    ]);
  });

  step(
    'the workspace quota stops a write past it, and freeing space brings the session back',
    async () => {
      const quota = 512 * 1024 ** 2; // SANDBOX_INCUS_WORKSPACE_SIZE of the lab
      let freed: Reply | undefined;
      try {
        const filled = await api.exec(S1, {
          shell:
            'dd if=/dev/urandom of=/agent/e2e/quota.bin bs=1M count=700 2>&1; echo "rc=$?"',
          timeoutMs: 120_000,
        });
        // The quota ends it in one of two ways, by timing: the shell finishes
        // (dd is refused, rc=1), or runnerd, whose output spool lives on the
        // workspace, cannot journal what follows and ends the exec with a
        // REPLAY_ code (documented in sessions.md).
        const text = `${filled.stdout}${filled.stderr}`.toLowerCase();
        const finished = filled.result?.status === 'completed';
        report.fact(
          'the write past the quota',
          `${finished ? 'the shell finished' : `the exec was ended: ${asText(filled.streamError)}`} | ${text.trim().replaceAll('\n', ' | ').slice(-200)}`,
        );
        if (finished) {
          expect(text).toMatch(/no space left|quota exceeded/);
          expect(text).toMatch(/rc=1/);
        } else {
          expect(asText(filled.streamError)).toContain('REPLAY_');
        }
        // What the node says, however the exec ended: the volume is full, and
        // no fuller. ZFS accounts a write when its transaction group commits,
        // a few seconds on, and holds a quota to within the group in flight.
        const usage = await until(
          'the volume to account for the write',
          async () => {
            const now = await admin.volumeUsage(incusWorkspaceVolumeName(S1));
            return now.used > quota * 0.9 ? now : undefined;
          },
          { timeoutMs: 60_000, intervalMs: 2_000 },
        );
        report.fact(
          'the workspace volume after the write',
          `${usage.used} of ${usage.total ?? '?'} bytes`,
        );
        expect(usage.used).toBeLessThanOrEqual(quota + 8 * 1024 ** 2);
        if (usage.total !== undefined) expect(usage.total).toBe(quota);
      } finally {
        // The files API needs no journal: it frees the space, and the session
        // is back. (If it cannot, the node does, so that the next step runs.)
        freed = await api.deleteFiles(S1, ['e2e/quota.bin']);
        if (freed.status !== 200) {
          const name = (await sessionInstance(S1))?.name;
          if (name !== undefined) {
            await admin.exec(name, ['rm', '-f', '/agent/e2e/quota.bin'], {
              allowFailure: true,
            });
          }
        }
      }
      expectStatus(freed, 200, 'free the space through the files API');
      expect(
        await sh(
          api,
          S1,
          'echo fine > /agent/e2e/after-quota && cat /agent/e2e/after-quota',
        ),
      ).toBe('fine\n');
    },
  );

  step('the workspace survives stop; resume mounts it again', async () => {
    const before = created1();
    await sh(
      api,
      S1,
      'mkdir -p /agent/e2e && echo persisted > /agent/e2e/marker && echo second > /agent/e2e/second',
    );
    const stopStarted = performance.now();
    const stopped = await api.stop(S1);
    expectStatus(stopped, 200, 'stop');
    expect(field(stopped.json, 'stopped')).toBe(true);
    expect(field(stopped.json, 'workspaceKept')).toBe(true);
    report.add(
      'stop (instance removed, workspace kept)',
      performance.now() - stopStarted,
    );

    // The compute is gone; the volume is not; the session is unknown.
    expect(await sessionInstance(S1)).toBeUndefined();
    expect(await sessionVolume(S1)).toBeDefined();
    expect((await api.get(S1)).status).toBe(404);

    const resumed = await api.create({
      sessionId: S1,
      organizationId: ORG,
      profile: 'agent',
      ttlMs: 3_600_000,
      idleTimeoutMs: 1_800_000,
    });
    expectStatus(resumed.reply, 201, 'resume');
    report.add('resume (create over the kept workspace)', resumed.elapsedMs);
    const session = resumed.session;
    if (session === undefined) throw new Error('no session in the resume');
    expect(session.createdAtMs).not.toBe(before.createdAtMs);
    created = { ...before, createdAtMs: session.createdAtMs };

    // The files are there, owned by the session user, under a new idmap.
    expect(
      await sh(
        api,
        S1,
        'cat /agent/e2e/marker /agent/e2e/second; stat -c "%u" /agent/e2e/marker',
      ),
    ).toBe('persisted\nsecond\n10001\n');
    expect(
      await sh(
        api,
        S1,
        'echo again > /agent/e2e/after-resume && stat -c "%u:%g" /agent/e2e/after-resume',
      ),
    ).toBe('10001:10001\n');
    const instance = await sessionInstance(S1);
    expect(label(instance?.config ?? {}, LABEL.created)).toBe(
      String(session.createdAtMs),
    );
  });

  step(
    'a second create of a live session is a duplicate, and touches nothing',
    async () => {
      const before = await sessionInstance(S1);
      const duplicate = await api.create({
        sessionId: S1,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(duplicate.reply, 409, 'duplicate create');
      expect(field(duplicate.reply.json, 'error')).toBe('duplicate');
      const after = await sessionInstance(S1);
      expect(after?.createdAt).toBe(before?.createdAt);
      expect(after?.status).toBe('Running');
      expect(await sh(api, S1, 'cat /agent/e2e/marker')).toBe('persisted\n');
    },
  );

  step('a pin is written to the instance and read back', async () => {
    const pinned = await api.pin(S1, true);
    expectStatus(pinned, 200, 'pin');
    expect(field(pinned.json, 'pinned')).toBe(true);
    expect(field((await api.get(S1)).json, 'session', 'pinned')).toBe(true);
    expect(label((await sessionInstance(S1))?.config ?? {}, LABEL.pinned)).toBe(
      'true',
    );
    expectStatus(await api.pin(S1, false), 200, 'unpin');
    expect(field((await api.get(S1)).json, 'session', 'pinned')).toBe(false);
    expect(
      label((await sessionInstance(S1))?.config ?? {}, LABEL.pinned),
    ).toBeUndefined();
  });

  step(
    'two creates of one id at once: one wins, the other is a duplicate',
    async () => {
      const [first, second] = await Promise.all([
        api.create({
          sessionId: RACE,
          organizationId: ORG,
          profile: 'agent-light',
        }),
        api.create({
          sessionId: RACE,
          organizationId: ORG,
          profile: 'agent-light',
        }),
      ]);
      expect(
        [first.reply.status, second.reply.status].sort((a, b) => a - b),
      ).toEqual([201, 409]);
      expect(
        (await admin.instances()).filter(
          (i) => label(i.config, LABEL.session) === RACE,
        ),
      ).toHaveLength(1);
      expectStatus(await api.destroy(RACE), 200, 'destroy the race winner');
    },
  );

  step('a render session gets a scratch volume that goes with it', async () => {
    const result = await api.create({
      sessionId: RENDER,
      organizationId: ORG,
      profile: 'default',
      workload: 'workflow',
    });
    expectStatus(result.reply, 201, 'render create');
    report.add('cold create, default (render) profile', result.elapsedMs);
    expect((await sh(api, RENDER, 'id -u')).trim()).toBe('65534');
    expect(
      await sh(api, RENDER, 'echo scratch > /agent/probe && cat /agent/probe'),
    ).toBe('scratch\n');
    const volume = await sessionVolume(RENDER);
    expect(label(volume?.config ?? {}, LABEL.profile)).toBe('default');
    const destroyed = await api.destroy(RENDER);
    expectStatus(destroyed, 200, 'render destroy');
    expect(await sessionVolume(RENDER)).toBeUndefined();
    expect(await sessionInstance(RENDER)).toBeUndefined();
  });

  step(
    'bursts of sessions created at once each get an address, a workspace and a host uid range of their own',
    async () => {
      // The main session still holds one of the spawner's six.
      const burst = 5;
      const rounds = 3;
      let slowest = 0;
      for (let round = 1; round <= rounds; round += 1) {
        const ids = Array.from({ length: burst }, () => sessionId('par'));
        const started = performance.now();
        const results = await Promise.all(
          ids.map((id) =>
            api.create({
              sessionId: id,
              organizationId: ORG,
              profile: 'agent-light',
            }),
          ),
        );
        for (const [index, result] of results.entries()) {
          expectStatus(
            result.reply,
            201,
            `round ${round}: create ${ids[index]}`,
          );
          slowest = Math.max(slowest, result.elapsedMs);
        }
        report.add(
          `${burst} creates at once, round ${round} (wall time)`,
          performance.now() - started,
          results
            .map((result) => `${Math.round(result.elapsedMs)} ms`)
            .join(', '),
        );
        const addresses = await Promise.all(
          ids.map(async (id) => (await sessionInstance(id))?.addresses[0]),
        );
        expect(new Set(addresses).size).toBe(burst);
        await Promise.all(
          ids.map((id, index) => sh(api, id, `echo ${index} > /agent/who`)),
        );
        for (const [index, id] of ids.entries()) {
          expect(await sh(api, id, 'cat /agent/who')).toBe(`${index}\n`);
        }
        // Isolated idmaps: no two sessions share a range of host uids.
        const bases = await Promise.all(
          ids.map((id) =>
            sh(api, id, "awk '$1 == 0 { print $2 }' /proc/self/uid_map"),
          ),
        );
        expect(new Set(bases.map((base) => base.trim())).size).toBe(burst);
        if (round === 1) {
          report.fact(
            'host uid bases of one burst',
            bases.map((base) => base.trim()).join(', '),
          );
        }
        for (const id of ids)
          expectStatus(await api.destroy(id), 200, `destroy ${id}`);
      }
      report.fact(
        'the slowest create of the bursts',
        `${Math.round(slowest)} ms`,
      );
    },
  );

  step(
    'destroy removes the instance and the workspace, and says so',
    async () => {
      const started = performance.now();
      const destroyed = await api.destroy(S1);
      expectStatus(destroyed, 200, 'destroy');
      expect(field(destroyed.json, 'destroyed')).toBe(true);
      expect(field(destroyed.json, 'deletion')).toBe('done');
      report.add(
        'destroy (instance and workspace volume)',
        performance.now() - started,
      );
      expect(await sessionInstance(S1)).toBeUndefined();
      expect(await sessionVolume(S1)).toBeUndefined();
      expect((await api.get(S1)).status).toBe(404);
      const inventory = await api.workspaces();
      expectStatus(inventory, 200, 'workspace inventory');
      expect(inventory.text).not.toContain(S1);
      // Destroying what is gone is not an error, and says nothing was there.
      const again = await api.destroy(S1);
      expectStatus(again, 200, 'second destroy');
      expect(field(again.json, 'destroyed')).toBe(false);
    },
  );
});
