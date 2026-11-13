import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { FakeExecCall } from '@tale/incus/fake';

import { CliError } from '../../../../utils/fail';
import { retireColor } from '../../../actions/color-lifecycle';
import { setProjectId } from '../../../project/project-context';
import { FakeRuntime } from '../../fake-runtime';
import { goldenTarget } from '../apply/apply-fixture';
import { readJournal } from '../apply/journal';
import {
  compileInput,
  factsFor,
  statefulDocument,
} from '../compile/compile-fixture';
import {
  compileStackTarget,
  type IncusDeclaration,
} from '../compile/stack-target';
import { IncusRuntime } from '../incus-runtime';
import {
  renderUpstreams,
  SWITCH_VOLUME,
  switchApplyHooks,
  switchFiles,
  WITHDRAWAL_MARKERS,
  WITHDRAWAL_SETTLE_MS,
} from './switch';
import {
  seedStackInstance,
  STACK,
  verbsFixture,
  type VerbsFixture,
} from './verbs-fixture';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('the switch lists every slot once (design 5.3, R3-02)', () => {
  test('a /24 lists both colours of each role; the switch owns the files', () => {
    const files = switchFiles(goldenTarget('stateful'));
    expect(
      files.map(({ volume, path, mode, write, instance }) => ({
        volume,
        path,
        mode,
        write,
        instance,
      })),
    ).toEqual([
      {
        volume: SWITCH_VOLUME,
        path: 'platform.upstreams',
        mode: 0o644,
        write: 'overwrite',
        instance: 'switch',
      },
      {
        volume: SWITCH_VOLUME,
        path: 'backend-api.upstreams',
        mode: 0o644,
        write: 'overwrite',
        instance: 'switch',
      },
    ]);
    const slots = (from: number, port: number) =>
      Array.from({ length: 16 }, (_, i) => `10.30.1.${from + i}:${port}`);
    expect(decode(files[0]?.content ?? new Uint8Array())).toBe(
      `to ${[...slots(64, 3000), ...slots(128, 3000)].join(' ')}\n`,
    );
    expect(decode(files[1]?.content ?? new Uint8Array())).toBe(
      `to ${[...slots(80, 3005), ...slots(144, 3005)].join(' ')}\n`,
    );
  });

  test('a managed /25 lists the blue slots alone', () => {
    const [platform] = switchFiles(goldenTarget('managed-compose'));
    const listed = decode(platform?.content ?? new Uint8Array())
      .trim()
      .split(' ')
      .slice(1);
    expect(listed).toHaveLength(16);
    expect(listed[0]).toBe('10.30.2.64:3000');
    expect(listed[15]).toBe('10.30.2.79:3000');
  });

  test('only addresses with a port reach the file', () => {
    expect(() => renderUpstreams([])).toThrow();
    expect(() =>
      renderUpstreams(['10.30.1.64:3000\nreverse_proxy x']),
    ).toThrow();
    expect(() => renderUpstreams(['platform:3000'])).toThrow();
  });
});

describe('an image of another line is refused (R3-23)', () => {
  const proxy = (labels: Record<string, string>) => {
    const input = compileInput('workspace', [{ compose: statefulDocument() }]);
    const images = Object.fromEntries(
      Object.entries(input.images).map(([reference, facts]) => [
        reference,
        reference.includes('/tale-proxy')
          ? factsFor(reference, { labels: { ...facts.labels, ...labels } })
          : facts,
      ]),
    );
    return compileStackTarget({ ...input, images });
  };

  test('a proxy image that does not read switch-upstreams/1 fails closed', () => {
    for (const formats of ['', 'traefik-dynamic/1', 'switch-upstreams/2']) {
      const result = proxy({ 'dev.tale.infra-formats': formats });
      expect(result.target).toBeNull();
      expect(result.refusals).toContainEqual(
        expect.objectContaining({
          id: 'infra-format',
          service: 'switch',
          detail: expect.stringContaining('switch-upstreams/1'),
        }),
      );
    }
    expect(
      proxy({ 'dev.tale.infra-formats': 'names-hosts/1 switch-upstreams/1' })
        .target,
    ).not.toBeNull();
  });
});

describePosix('withdraw and admit on Incus (design 7.3, R3-26, R3-34)', () => {
  let fixture: VerbsFixture;
  let sleeps: number[];
  let runtime: IncusRuntime;

  const declaration: IncusDeclaration = {
    project: 'tale-stack',
    pool: 'tale',
    network: {
      name: 'talebr0',
      subnet: '10.30.0.0/16',
      gateway: '10.30.0.1',
      block: '10.30.1.0/24',
    },
    sessions: { subnet: '10.31.0.0/24' },
    ingress: { mode: 'routed' },
  };

  /** What touch and rm do to the instance's files, as its user. */
  const execs: FakeExecCall[] = [];
  const replica = (
    name: string,
    service: string,
    colour: 'blue' | 'green',
    options: { image?: string; status?: 'Running' | 'Stopped' } = {},
  ) =>
    seedStackInstance(fixture.fake, name, {
      service,
      config: { 'user.tale.colour': colour },
      ...(options.image === undefined ? {} : { image: options.image }),
      ...(options.status === undefined ? {} : { status: options.status }),
    });
  const markers = () =>
    [...fixture.fake.instances.values()]
      .flatMap((instance) =>
        [...instance.files.entries()]
          .filter(([path]) => path.startsWith('/tmp/'))
          .map(([path, file]) => `${instance.name}:${path}:${file.uid}`),
      )
      .sort();

  beforeEach(() => {
    fixture = verbsFixture();
    sleeps = [];
    execs.length = 0;
    fixture.fake.exec = (call) => {
      execs.push(call);
      const [command, ...rest] = call.command;
      const path = rest.at(-1) ?? '';
      if (command === 'touch')
        call.instance.files.set(path, {
          content: '',
          mode: '0644',
          uid: call.user,
          gid: call.group,
        });
      if (command === 'rm') call.instance.files.delete(path);
      return 0;
    };
    runtime = new IncusRuntime({
      client: fixture.context.client,
      declaration,
      stack: STACK,
      stateRoot: fixture.stateRoot,
      switchDependencies: {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    });
    replica('platform-blue-1', 'platform', 'blue');
    replica('platform-blue-2', 'platform', 'blue');
    replica('backend-api-blue-1', 'backend-api', 'blue');
    replica('backend-worker-blue-1', 'backend-worker', 'blue');
    replica('platform-green-1', 'platform', 'green');
    replica('backend-api-blue-2', 'backend-api', 'blue', {
      status: 'Stopped',
    });
  });
  afterEach(() => {
    fixture.remove();
  });

  test('withdraw marks every running switched replica of the colour as the app user, waits, and cuts nothing', async () => {
    expect(runtime.withdrawal).toBe('marker');
    expect(
      await runtime.withdraw(`${STACK}-blue`, [
        'platform',
        'backend-api',
        'backend-worker',
      ]),
    ).toBe(0);
    expect(markers()).toEqual([
      `backend-api-blue-1:${WITHDRAWAL_MARKERS['backend-api']}:1001`,
      `platform-blue-1:${WITHDRAWAL_MARKERS.platform}:1001`,
      `platform-blue-2:${WITHDRAWAL_MARKERS.platform}:1001`,
    ]);
    expect(
      execs.map((call) => [call.command.join(' '), call.user, call.group]),
    ).toEqual([
      ['touch /tmp/backend-withdrawn', 1001, 1001],
      ['touch /tmp/platform-withdrawn', 1001, 1001],
      ['touch /tmp/platform-withdrawn', 1001, 1001],
    ]);
    expect(sleeps).toEqual([WITHDRAWAL_SETTLE_MS]);
    expect(WITHDRAWAL_SETTLE_MS).toBe(4_000);
    expect((await readJournal(fixture.stateRoot))?.withdrawn).toEqual([
      { instance: 'backend-api-blue-1', marker: '/tmp/backend-withdrawn' },
      { instance: 'platform-blue-1', marker: '/tmp/platform-withdrawn' },
      { instance: 'platform-blue-2', marker: '/tmp/platform-withdrawn' },
    ]);
  });

  test('withdraw and admit are idempotent', async () => {
    await runtime.withdraw(`${STACK}-blue`, ['platform']);
    const after = markers();
    execs.length = 0;
    expect(await runtime.withdraw(`${STACK}-blue`, ['platform'])).toBe(0);
    expect(markers()).toEqual(after);
    // A marker that is there already is kept: no exec runs again.
    expect(execs).toEqual([]);
    expect((await readJournal(fixture.stateRoot))?.withdrawn).toHaveLength(2);

    await runtime.admit(`${STACK}-blue`, ['platform']);
    expect(markers()).toEqual([]);
    expect(execs.map((call) => [call.command.join(' '), call.user])).toEqual([
      ['rm -f /tmp/platform-withdrawn', 1001],
      ['rm -f /tmp/platform-withdrawn', 1001],
    ]);
    expect((await readJournal(fixture.stateRoot))?.withdrawn).toEqual([]);
    execs.length = 0;
    await runtime.admit(`${STACK}-blue`, ['platform', 'backend-api']);
    // Admitting a replica without a marker runs nothing.
    expect(execs).toEqual([]);
  });

  test('an in-place roll withdraws and admits the replicas it names, alone', async () => {
    await runtime.withdraw(STACK, ['platform'], ['platform-blue-2']);
    expect(markers()).toEqual([
      `platform-blue-2:${WITHDRAWAL_MARKERS.platform}:1001`,
    ]);
    await runtime.withdraw(STACK, ['platform'], ['platform-green-1']);
    await runtime.admit(STACK, ['platform'], ['platform-green-1']);
    expect(markers()).toEqual([
      `platform-blue-2:${WITHDRAWAL_MARKERS.platform}:1001`,
    ]);
  });

  test('without the app user of the image, nothing is set as root', async () => {
    replica('platform-blue-3', 'platform', 'blue', {
      image: `sha256:${'3'.repeat(64)}`,
    });
    const error = await runtime
      .withdraw(`${STACK}-blue`, ['platform'], ['platform-blue-3'])
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(CliError);
    expect((error as Error).message).toContain('name no app user');
    expect(execs).toEqual([]);
  });

  test('a stack the runtime does not run is refused', async () => {
    const error = await runtime.withdraw('other-blue', ['platform']).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(CliError);
    expect(execs).toEqual([]);
  });

  test("the applier's hooks withdraw a switched replica before its drain, and admit only a known marker", async () => {
    const hooks = switchApplyHooks(fixture.context, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(await hooks.withdraw('platform-blue-1', 'platform')).toBe(
      WITHDRAWAL_MARKERS.platform,
    );
    expect(sleeps).toEqual([WITHDRAWAL_SETTLE_MS]);
    expect(
      await hooks.withdraw('backend-worker-blue-1', 'backend-worker'),
    ).toBe(null);
    expect(sleeps).toEqual([WITHDRAWAL_SETTLE_MS]);
    await hooks.admit('platform-blue-1', WITHDRAWAL_MARKERS.platform);
    expect(markers()).toEqual([]);
    await expect(hooks.admit('platform-blue-1', '/etc/passwd')).rejects.toThrow(
      'no withdrawal marker',
    );
  });
});

describe('a flip withdraws where its runtime allows (design 7.3, R3-34)', () => {
  const PROJECT = 'tale';
  const IMAGE = 'ghcr.io/tale-project/tale/tale-platform:0.5.0';

  /** retireColor over a fake runtime; the verbs it ran, in order. */
  async function retire(withdrawal: 'disconnect' | 'marker') {
    setProjectId(PROJECT);
    const fake = new FakeRuntime({ withdrawal });
    for (const colour of ['blue', 'green'])
      for (const service of ['platform', 'backend-api', 'backend-worker'])
        fake.seedInstance({
          stack: `${PROJECT}-${colour}`,
          service,
          image: IMAGE,
          networks: [`${PROJECT}_internal`],
        });
    fake.execHandler = (instance, argv) => {
      fake.journal.push(`exec ${instance.name} ${argv.join(' ')}`);
      return undefined;
    };
    await retireColor({ color: 'blue', drainTimeout: 0, runtime: fake });
    const steps = fake.journal.filter(
      (entry) =>
        entry.startsWith('withdraw ') ||
        entry.startsWith('stop ') ||
        (entry.startsWith('exec ') && entry.includes('drain')),
    );
    return { fake, steps };
  }

  test('Docker disconnects after the drain, right before the stop', async () => {
    const { fake, steps } = await retire('disconnect');
    const withdraw = steps.findIndex((step) => step.startsWith('withdraw '));
    const drain = steps.findIndex((step) => step.startsWith('exec '));
    const stop = steps.findIndex((step) => step.startsWith('stop '));
    expect(drain).toBeGreaterThanOrEqual(0);
    expect(drain).toBeLessThan(withdraw);
    expect(withdraw).toBeLessThan(stop);
    expect(steps[withdraw]).toBe(
      `withdraw ${PROJECT}-blue platform,backend-api`,
    );
    expect(fake.withdrawn.size).toBe(0);
  });

  test('Incus marks before the drain, and nothing is cut', async () => {
    const { fake, steps } = await retire('marker');
    const withdraw = steps.findIndex((step) => step.startsWith('withdraw '));
    const drain = steps.findIndex((step) => step.startsWith('exec '));
    const stop = steps.findIndex((step) => step.startsWith('stop '));
    expect(withdraw).toBe(0);
    expect(withdraw).toBeLessThan(drain);
    expect(drain).toBeLessThan(stop);
    expect(steps.filter((step) => step.startsWith('withdraw '))).toHaveLength(
      1,
    );
    expect([...fake.withdrawn].sort()).toEqual([
      `${PROJECT}-blue-backend-api-1`,
      `${PROJECT}-blue-platform-1`,
    ]);
  });
});
