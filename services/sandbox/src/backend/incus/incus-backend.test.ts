// The Incus host backend: boot checks, health, getting the runtime image in,
// and the sweep of debris.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { IncusBackend } from './incus-backend.ts';
import { IncusClient } from './incus-client.ts';
import {
  incusInstanceName,
  incusWarmupInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
} from './incus-naming.ts';
import { IncusRuntime } from './incus-runtime.ts';
import { sessionFixture, START_MS } from './incus-session-fixture.ts';
import { rejection } from './incus-test-support.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  log = spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  log.mockRestore();
});

function hostFixture(options: Parameters<typeof sessionFixture>[0] = {}) {
  const f = sessionFixture(options);
  return { ...f, host: new IncusBackend(f.cfg, { runtime: f.runtime }) };
}

describe('init', () => {
  test('passes on a node set up as the docs describe, and says what it found', async () => {
    const f = hostFixture();
    await f.host.init();
    expect(warn).not.toHaveBeenCalled();
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toContain('Incus 7.5.1');
    expect(line).toContain('project=sandbox-pr');
    expect(line).toContain('(zfs)');
  });

  test('starts the warm pool after the checks', async () => {
    const f = hostFixture({ incus: { poolSize: 2 }, maxSessions: 8 });
    await f.host.init();
    const { pool } = await f.runtime.connect();
    await pool.reconcile();
    expect(pool.readyCount()).toBe(2);
    await f.host.shutdown();
  });

  test('refuses a server that does not trust the certificate, and says how to add it', async () => {
    const f = hostFixture();
    f.fake.auth = 'untrusted';
    const error = await rejection(f.host.init());
    expect(error.message).toContain('does not trust this client certificate');
    expect(error.message).toContain(
      'incus config trust add-certificate <client.crt> --restricted --projects sandbox-pr',
    );
  });

  test('names the setting to look at when the project cannot be read', async () => {
    const f = sessionFixture();
    const client = new IncusClient({
      endpoint: 'https://incus.fake:8443',
      project: f.cfg.incus?.project ?? '',
      tls: { ca: 'ca', cert: 'cert', key: 'key' },
      fetch: async (url, init) =>
        // The fake serves another project than the one asked for.
        f.fake.fetch(url.replace('sandbox-pr', 'elsewhere'), init),
      sleep: async () => undefined,
    });
    const runtime = new IncusRuntime(f.cfg, { client });
    const error = await rejection(new IncusBackend(f.cfg, { runtime }).init());
    expect(error.message).toContain('cannot read Incus project sandbox-pr');
    expect(error.message).toContain('SANDBOX_INCUS_PROJECT');
  });

  test('refuses, listing every problem at once, a node that cannot run sessions', async () => {
    const f = hostFixture();
    f.fake.projectConfig['features.storage.volumes'] = 'false';
    f.fake.networkManaged = false;
    delete f.fake.profileDevices.eth0;
    const error = await rejection(f.host.init());
    expect(error.message).toContain('features.storage.volumes');
    expect(error.message).toContain('not managed');
    expect(error.message).toContain('no network device');
    expect(error.message.split('\n- ').length).toBeGreaterThanOrEqual(4);
  });

  test('refuses a project whose limits.cpu would refuse every create', async () => {
    const f = hostFixture();
    f.fake.projectConfig['limits.cpu'] = '64';
    const error = await rejection(f.host.init());
    expect(error.message).toContain('limits.cpu');
    expect(error.message).toContain('incus project unset');
  });

  test('warns, but goes on, about what is allowed and worth knowing', async () => {
    const f = hostFixture({ incus: { poolSize: 0 } });
    f.fake.projectConfig['features.images'] = 'false';
    await f.host.init();
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('features.images'),
      ),
    ).toBe(true);
  });

  test('does not start the pool on a node it refused', async () => {
    const f = hostFixture({ incus: { poolSize: 2 }, maxSessions: 8 });
    f.fake.networkManaged = false;
    await rejection(f.host.init());
    await Bun.sleep(30);
    expect(f.fake.seen('POST /1.0/instances')).toHaveLength(0);
  });
});

describe('health', () => {
  test('is ok while the node answers and trusts the certificate', async () => {
    const f = hostFixture({ incus: { poolSize: 2 }, maxSessions: 8 });
    const result = await f.host.health();
    expect(result).toEqual({
      ok: true,
      detail: 'incus 7.5.1 project=sandbox-pr warm=0/2',
    });
  });

  test('says no when the server does not trust the certificate', async () => {
    const f = hostFixture();
    f.fake.auth = 'untrusted';
    const result = await f.host.health();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('does not trust');
  });

  test('says no when the node cannot be reached', async () => {
    const f = hostFixture();
    f.fake.fail({ match: 'GET /1.0', status: 503, message: 'down', times: 5 });
    const result = await f.host.health();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toContain('down');
  });
});

describe('warmImage', () => {
  test('is done once the alias is there, and unpacks the image into the pool once', async () => {
    const f = hostFixture();
    await f.host.warmImage();
    const creates = f.fake.seen('POST /1.0/instances');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toMatchObject({
      start: false,
      ephemeral: false,
      source: { type: 'image', alias: 'tale-sandbox-runtime' },
    });
    // The throwaway instance is gone again.
    expect(f.fake.instances.size).toBe(0);
    // The same image is not unpacked twice.
    await f.host.warmImage();
    expect(f.fake.seen('POST /1.0/instances')).toHaveLength(1);
  });

  test('unpacks a new image when the alias moves', async () => {
    const f = hostFixture();
    await f.host.warmImage();
    f.fake.addImage('tale-sandbox-runtime', '9'.repeat(64));
    await f.host.warmImage();
    expect(f.fake.seen('POST /1.0/instances')).toHaveLength(2);
  });

  test('throws while the image is absent and no source says where to get it', async () => {
    const f = hostFixture();
    f.fake.aliases.clear();
    const error = await rejection(f.host.warmImage());
    expect(error.message).toContain('tale-sandbox-runtime');
    expect(error.message).toContain('SANDBOX_INCUS_IMAGE_SOURCE');
    expect(error.message).toContain('incus image copy');
    expect(f.fake.seen('POST /1.0/images')).toHaveLength(0);
  });

  test('pulls the image from its registry when it is absent', async () => {
    const f = hostFixture({
      incus: {
        imageSource: {
          server: 'https://ghcr.io',
          alias: 'tale-project/tale-sandbox-runtime:v1',
        },
      },
    });
    f.fake.aliases.clear();
    await f.host.warmImage();
    expect(f.fake.seen('POST /1.0/images')[0]?.body).toMatchObject({
      aliases: [{ name: 'tale-sandbox-runtime' }],
      source: {
        type: 'image',
        mode: 'pull',
        protocol: 'oci',
        server: 'https://ghcr.io',
        alias: 'tale-project/tale-sandbox-runtime:v1',
      },
    });
    expect(f.fake.aliases.has('tale-sandbox-runtime')).toBe(true);
  });

  test('throws, so the warm-up tries again, when the pull fails', async () => {
    const f = hostFixture({
      incus: {
        imageSource: { server: 'https://ghcr.io', alias: 'x/y:v1' },
      },
    });
    f.fake.aliases.clear();
    f.fake.pullFailure = 'registry unreachable';
    const error = await rejection(f.host.warmImage());
    expect(error.message).toContain('registry unreachable');
  });

  test('unpacks under a project that adds up memory and processes, which a bare instance would not pass', async () => {
    const f = hostFixture();
    f.fake.projectConfig['limits.memory'] = '64GiB';
    f.fake.projectConfig['limits.processes'] = '100000';
    await f.host.warmImage();
    expect(warn).not.toHaveBeenCalled();
    expect(f.fake.seen('POST /1.0/instances')).toHaveLength(1);
    expect(f.fake.instances.size).toBe(0);
  });

  test('does not fail for an unpack that fails: the first session pays for it', async () => {
    const f = hostFixture();
    f.fake.fail({
      match: 'POST /1.0/instances',
      status: 500,
      message: 'no space left',
    });
    await f.host.warmImage();
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('unpacking the runtime image'),
      ),
    ).toBe(true);
  });
});

describe('sweepOrphans', () => {
  function labels(id: string, extra: Record<string, string> = {}) {
    return {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: id,
      [LABEL.created]: String(START_MS),
      ...extra,
    };
  }

  /** The clock stands well past any create's budget after Incus made
   * everything seeded. */
  function late(f: ReturnType<typeof hostFixture>) {
    f.clock.now = Date.parse('2026-10-11T12:30:00Z');
  }

  test('removes an ended session instance nobody reaped, once its start is long over', async () => {
    const f = hostFixture();
    f.fake.seedInstance(incusInstanceName('dead'), labels('dead'), {
      status: 'Stopped',
      ephemeral: false,
    });
    f.fake.seedInstance(incusInstanceName('live'), labels('live'));
    late(f);
    expect(await f.host.sweepOrphans()).toBe(1);
    expect(f.fake.instances.has(incusInstanceName('dead'))).toBe(false);
    expect(f.fake.instances.has(incusInstanceName('live'))).toBe(true);
  });

  test('leaves an ended instance whose start is not over', async () => {
    const f = hostFixture();
    f.fake.seedInstance(incusInstanceName('dead'), labels('dead'), {
      status: 'Stopped',
      ephemeral: false,
    });
    f.clock.now = Date.parse('2026-10-11T12:00:30Z');
    expect(await f.host.sweepOrphans()).toBe(0);
    expect(f.fake.instances.has(incusInstanceName('dead'))).toBe(true);
  });

  test('removes the debris of a crashed warm-up', async () => {
    const f = hostFixture();
    f.fake.seedInstance(
      incusWarmupInstanceName('abc'),
      {},
      {
        status: 'Stopped',
        ephemeral: false,
      },
    );
    expect(await f.host.sweepOrphans()).toBe(1);
    expect(f.fake.instances.size).toBe(0);
  });

  test('removes the scratch volume of a render session whose instance is gone', async () => {
    const f = hostFixture();
    const scratch = (id: string, extra: Record<string, string> = {}) =>
      f.fake.seedVolume(incusWorkspaceVolumeName(id), {
        [LABEL.workspace]: '1',
        [LABEL.session]: id,
        [LABEL.profile]: 'default',
        ...extra,
      });
    scratch('orphan');
    scratch('serving');
    scratch('device', { [LABEL.spawnerInstance]: 'device' });
    f.fake.seedInstance(incusInstanceName('serving'), labels('serving'), {});
    late(f);
    expect(await f.host.sweepOrphans()).toBe(1);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName('orphan'))).toBe(false);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName('serving'))).toBe(true);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName('device'))).toBe(true);
  });

  test('leaves a scratch volume a create may be about to use', async () => {
    const f = hostFixture();
    f.fake.seedVolume(incusWorkspaceVolumeName('new'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'new',
      [LABEL.profile]: 'default',
    });
    // Just made: inside a create's budget.
    f.clock.now = Date.parse('2026-10-11T12:00:05Z');
    expect(await f.host.sweepOrphans()).toBe(0);

    // And one whose create is under way on this spawner, however old.
    late(f);
    f.runtime.inFlight.add('new');
    expect(await f.host.sweepOrphans()).toBe(0);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName('new'))).toBe(true);
  });

  test('never takes a volume that does not say it is scratch', async () => {
    const f = hostFixture();
    for (const [id, profile] of [
      ['silent', undefined],
      ['blank', ''],
      ['light', 'agent-light'],
    ] as const) {
      f.fake.seedVolume(incusWorkspaceVolumeName(id), {
        [LABEL.workspace]: '1',
        [LABEL.session]: id,
        ...(profile === undefined ? {} : { [LABEL.profile]: profile }),
      });
    }
    late(f);
    expect(await f.host.sweepOrphans()).toBe(0);
    expect(f.fake.volumes.size).toBe(3);
  });

  test('never touches an agent session’s workspace: the platform destroys those', async () => {
    const f = hostFixture();
    f.fake.seedVolume(incusWorkspaceVolumeName('parked'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'parked',
      [LABEL.profile]: 'agent',
    });
    late(f);
    expect(await f.host.sweepOrphans()).toBe(0);
    expect(f.fake.volumes.size).toBe(1);
  });

  test('reports what it removed and goes on past what it could not', async () => {
    const f = hostFixture();
    f.fake.seedInstance(
      incusWarmupInstanceName('a'),
      {},
      {
        status: 'Stopped',
        ephemeral: false,
      },
    );
    f.fake.seedInstance(
      incusWarmupInstanceName('b'),
      {},
      {
        status: 'Stopped',
        ephemeral: false,
      },
    );
    f.fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'busy',
      times: 100,
    });
    // The first cannot be removed (its deletes are refused); the sweep
    // reports neither and says why.
    expect(await f.host.sweepOrphans()).toBe(0);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('failed')),
    ).toBe(true);
  });

  test('throws when it cannot list, for the periodic tick to log', async () => {
    const f = hostFixture();
    f.fake.fail({
      match: 'GET /1.0/instances',
      status: 500,
      message: 'database is locked',
    });
    const error = await rejection(f.host.sweepOrphans());
    expect(error.message).toContain('database is locked');
  });
});

describe('shutdown and drain', () => {
  test('are quiet before anything connected, and after', async () => {
    const f = hostFixture();
    await f.host.shutdown();
    f.host.beginDrain();
    expect(f.fake.requests).toEqual([]);
    await f.host.init();
    await f.host.shutdown();
  });

  test('a draining spawner leaves the warm pool to its replacement', async () => {
    const f = hostFixture({ incus: { poolSize: 2 }, maxSessions: 8 });
    await f.host.init();
    const { pool } = await f.runtime.connect();
    await pool.reconcile();
    const standbys = () =>
      [...f.fake.instances.values()].filter((i) => i.config[LABEL.pool]);
    expect(standbys()).toHaveLength(2);

    f.host.beginDrain();
    // A standby is lost; the draining spawner does not make another.
    const [first] = standbys();
    if (first === undefined) throw new Error('no standby');
    f.fake.instances.delete(first.name);
    const report = await pool.reconcile();
    expect(report).toMatchObject({ created: 0, removed: 0 });
    expect(standbys()).toHaveLength(1);
  });

  test('a shutdown stops the pool the same way', async () => {
    const f = hostFixture({ incus: { poolSize: 1 }, maxSessions: 8 });
    await f.host.init();
    const { pool } = await f.runtime.connect();
    await f.host.shutdown();
    expect(await pool.reconcile()).toMatchObject({ created: 0, removed: 0 });
  });
});

describe('the kind', () => {
  test('is incus', () => {
    expect(hostFixture().host.kind).toBe('incus');
  });
});
