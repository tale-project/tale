import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunDockerResult } from '../spawn-util.ts';
import {
  applyDeviceStack,
  egressSpec,
  launchSelfUpdate,
  sandboxSpec,
  type ApplyDeps,
} from './apply.ts';
import { readUpdateStatus, type DeviceConfig } from './device-config.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function config(
  overrides: Partial<DeviceConfig> = {},
): Promise<DeviceConfig> {
  const stateDir = await mkdtemp(join(tmpdir(), 'tale-apply-'));
  dirs.push(stateDir);
  return {
    version: 1,
    serverUrl: 'https://tale.example',
    deviceId: 'dev-1',
    deviceSecret: 'tsd_x',
    organizationId: 'org_1',
    name: 'box',
    localToken: 'local-token',
    stateDir,
    maxSessions: 4,
    registry: 'ghcr.io/tale-project/tale',
    autoUpdate: true,
    relays: [
      { name: 'api', url: 'http://backend-api:3005' },
      { name: 'gateway', url: 'http://sandbox-llm-gateway:8080' },
    ],
    host: { os: 'darwin', arch: 'arm64', hostname: 'box' },
    ...overrides,
  };
}

/** The error a promise rejects with (fails the test if it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

const ok = (stdout = ''): RunDockerResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
});
const fail = (stderr: string): RunDockerResult => ({
  exitCode: 1,
  stdout: '',
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
});

/** A scripted docker: answers by the first matching rule, records calls. */
function fakeDocker(
  rules: Array<[(args: string[]) => boolean, RunDockerResult]>,
) {
  const calls: string[][] = [];
  const deps: ApplyDeps = {
    docker: (args) => {
      calls.push(args);
      for (const [match, result] of rules)
        if (match(args)) return Promise.resolve(result);
      return Promise.resolve(ok());
    },
    log: () => {},
    sleep: () => Promise.resolve(),
    now: () => 1_000,
  };
  return { deps, calls };
}

const is =
  (...prefix: string[]) =>
  (args: string[]) =>
    prefix.every((p, i) => args[i] === p);

describe('device stack layout', () => {
  test('the spawner answers every relay name and runs as the device instance', async () => {
    const cfg = await config();
    const spec = sandboxSpec(cfg, `${cfg.stateDir}/device.json`, {
      sandbox: 'ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
      runtime: 'ghcr.io/tale-project/tale/tale-sandbox-runtime:0.5.60',
    });
    expect(spec.aliases).toEqual([
      'backend-api',
      'llm-gateway',
      'sandbox-llm-gateway',
    ]);
    const env = spec.create.filter((_, i) => spec.create[i - 1] === '--env');
    expect(env).toContain('SANDBOX_INSTANCE=device');
    expect(env).toContain(`SANDBOX_HOST_SESSION_ROOT=${cfg.stateDir}/sessions`);
    expect(env).toContain('SANDBOX_EGRESS_NETWORK=tale-device-net');
    expect(env).toContain('SANDBOX_DOCKER_IN_CONTAINER=false');
    expect(env).toContain('SANDBOX_MAX_SESSIONS=4');
    // The device secret stays in the config file, never in `docker inspect`.
    expect(spec.create.join(' ')).not.toContain('tsd_x');
    expect(spec.create).toContain(`${cfg.stateDir}:${cfg.stateDir}`);
    expect(spec.create).toContain('/var/run/docker.sock:/var/run/docker.sock');
  });

  test('a rootless socket path is mounted where the daemon sees it', async () => {
    const cfg = await config({ dockerSocket: '/run/user/1000/docker.sock' });
    const spec = sandboxSpec(cfg, '/x/device.json', {
      sandbox: 's',
      runtime: 'r',
    });
    expect(spec.create).toContain(
      '/run/user/1000/docker.sock:/var/run/docker.sock',
    );
  });

  test('the egress proxy keeps the deployment posture', async () => {
    const spec = egressSpec(await config(), 'egress:1');
    expect(spec.aliases).toEqual(['sandbox-egress']);
    expect(spec.create).toContain('ALL');
    expect(spec.create).toContain('net.ipv6.conf.all.disable_ipv6=1');
    expect(spec.create.at(-1)).toBe('egress:1');
  });
});

describe('applyDeviceStack', () => {
  test('pulls first, then creates networks and both containers attached before start', async () => {
    const cfg = await config();
    const { deps, calls } = fakeDocker([
      [is('image', 'inspect'), fail('No such image')],
      [is('network', 'inspect'), fail('No such network')],
      [is('container', 'inspect', '--format'), fail('No such container')],
    ]);
    // Health reads come after create; answer them healthy.
    let created = 0;
    const wrapped: ApplyDeps = {
      ...deps,
      docker: (args, opts) => {
        if (args[0] === 'create') created++;
        if (
          created > 0 &&
          is('container', 'inspect')(args) &&
          args.at(-2)?.includes('Health')
        ) {
          calls.push(args);
          return Promise.resolve(ok('healthy'));
        }
        return deps.docker(args, opts);
      },
    };
    await applyDeviceStack(
      cfg,
      `${cfg.stateDir}/device.json`,
      '0.5.60',
      wrapped,
    );
    const verbs = calls.map((a) => a.slice(0, 2).join(' '));
    const firstPull = verbs.indexOf('pull --quiet');
    const firstCreate = verbs.findIndex((v) => v.startsWith('create'));
    expect(firstPull).toBeGreaterThanOrEqual(0);
    expect(firstPull).toBeLessThan(firstCreate);
    expect(calls.filter((a) => a[0] === 'pull').map((a) => a.at(-1))).toEqual([
      'ghcr.io/tale-project/tale/tale-sandbox-egress:0.5.60',
      'ghcr.io/tale-project/tale/tale-sandbox:0.5.60',
      'ghcr.io/tale-project/tale/tale-sandbox-runtime:0.5.60',
    ]);
    const internal = calls.find(
      (a) => is('network', 'create')(a) && a.includes('tale-device-net'),
    );
    expect(internal).toContain('--internal');
    for (const name of ['tale-device-egress', 'tale-device-sandbox']) {
      const create = calls.findIndex(
        (a) => a[0] === 'create' && a.includes(name),
      );
      const connect = calls.findIndex(
        (a) => is('network', 'connect')(a) && a.at(-1) === name,
      );
      const start = calls.findIndex((a) => is('start', name)(a));
      expect(create).toBeLessThan(connect);
      expect(connect).toBeLessThan(start);
    }
    const state = JSON.parse(
      await readFile(join(cfg.stateDir, 'state.json'), 'utf8'),
    );
    expect(state.appliedVersion).toBe('0.5.60');
  });

  test('a matching running container is left alone', async () => {
    const cfg = await config();
    const configPath = `${cfg.stateDir}/device.json`;
    // First run records the spec hashes the containers were created with.
    const hashes = new Map<string, string>();
    const { deps, calls } = fakeDocker([
      [is('network', 'inspect'), ok('true')],
    ]);
    const docker: ApplyDeps['docker'] = (args, opts) => {
      if (args[0] === 'create') {
        const name = args[args.indexOf('--name') + 1] ?? '';
        const spec =
          args.find((a) => a.startsWith('tale.device-spec='))?.split('=')[1] ??
          '';
        hashes.set(name, spec);
      }
      if (
        is('container', 'inspect')(args) &&
        args[3]?.includes('tale.device-spec')
      ) {
        const name = args.at(-1) ?? '';
        calls.push(args);
        const hash = hashes.get(name);
        return Promise.resolve(
          hash ? ok(`${hash}|true`) : fail('No such container'),
        );
      }
      if (is('container', 'inspect')(args)) {
        calls.push(args);
        return Promise.resolve(ok('healthy'));
      }
      return deps.docker(args, opts);
    };
    await applyDeviceStack(cfg, configPath, '0.5.60', { ...deps, docker });
    const createsBefore = calls.filter((a) => a[0] === 'create').length;
    await applyDeviceStack(cfg, configPath, '0.5.60', { ...deps, docker });
    expect(calls.filter((a) => a[0] === 'create').length).toBe(createsBefore);
    expect(calls.filter((a) => a[0] === 'stop')).toHaveLength(0);
  });

  test('a failed pull stops before touching the running stack', async () => {
    const cfg = await config();
    const { deps, calls } = fakeDocker([
      [is('image', 'inspect'), fail('No such image')],
      [is('pull'), fail('manifest unknown')],
    ]);
    const err = await rejection(
      applyDeviceStack(cfg, `${cfg.stateDir}/device.json`, '9.9.9', deps),
    );
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/manifest unknown/);
    expect(
      calls.some((a) => a[0] === 'stop' || a[0] === 'rm' || a[0] === 'create'),
    ).toBe(false);
  });

  test('refuses a sandbox network that is not internal', async () => {
    const cfg = await config();
    const { deps } = fakeDocker([
      [
        (a) => is('network', 'inspect')(a) && a.at(-1) === 'tale-device-net',
        ok('false'),
      ],
    ]);
    const err = await rejection(
      applyDeviceStack(cfg, `${cfg.stateDir}/device.json`, '0.5.60', deps),
    );
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/not internal/);
  });
});

describe('launchSelfUpdate', () => {
  test("runs the target release's helper detached, with the socket and state mounted", async () => {
    const cfg = await config();
    const { deps, calls } = fakeDocker([]);
    await launchSelfUpdate(cfg, `${cfg.stateDir}/device.json`, '0.5.61', deps);
    const run = calls[0] ?? [];
    expect(run.slice(0, 3)).toEqual(['run', '--detach', '--rm']);
    expect(run).toContain('tale-device-updater');
    expect(run).toContain('ghcr.io/tale-project/tale/tale-sandbox:0.5.61');
    expect(run.slice(-4)).toEqual([
      'device-apply',
      `${cfg.stateDir}/device.json`,
      '--version',
      '0.5.61',
    ]);
    expect((await readUpdateStatus(cfg.stateDir)).state).toBe('updating');
  });

  test('a launch failure is recorded for the organization to see', async () => {
    const cfg = await config();
    const { deps } = fakeDocker([[is('run'), fail('pull access denied')]]);
    const err = await rejection(
      launchSelfUpdate(cfg, `${cfg.stateDir}/device.json`, '0.5.61', deps),
    );
    expect(err).toBeInstanceOf(Error);
    expect(String(err)).toMatch(/pull access denied/);
    expect(await readUpdateStatus(cfg.stateDir)).toMatchObject({
      state: 'failed',
      targetVersion: '0.5.61',
      error: 'pull access denied',
    });
  });

  test('an updater already running is not an error', async () => {
    const cfg = await config();
    const { deps } = fakeDocker([
      [
        is('run'),
        fail(
          'Conflict. The container name "/tale-device-updater" is already in use',
        ),
      ],
    ]);
    await launchSelfUpdate(cfg, `${cfg.stateDir}/device.json`, '0.5.61', deps);
    expect((await readUpdateStatus(cfg.stateDir)).state).toBe('updating');
  });
});
