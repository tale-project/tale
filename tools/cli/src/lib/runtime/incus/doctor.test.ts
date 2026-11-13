import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IncusClient } from '@tale/incus/client';
import type { FakeIncus } from '@tale/incus/fake';
import {
  makeTestCertificates,
  type TestCertificates,
} from '@tale/incus/test-certificates';

import { clientOf, stackIncus } from './apply/apply-fixture';
import type { IncusDeclaration } from './compile/stack-target';
import { collectIncusChecks, type IncusDoctorOptions } from './doctor';
import { REQUIRED_EXTENSIONS } from './verbs/probe';

const describePosix = describe.skipIf(process.platform === 'win32');

const declaration: IncusDeclaration = {
  project: 'tale-stack',
  pool: 'tale',
  network: {
    name: 'talebr0',
    subnet: '10.30.0.0/23',
    gateway: '10.30.0.1',
    block: '10.30.0.0/24',
  },
  sessions: { subnet: '10.31.0.0/24' },
  ingress: { mode: 'proxy-device' },
};

let made: TestCertificates | undefined;
let fake: FakeIncus;
let workspace: string;
let connects: string[];
let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeAll(async () => {
  made = await makeTestCertificates();
});
afterAll(() => {
  made?.dispose();
});

beforeEach(() => {
  // The certificates live two days, inside the reader's expiry warning.
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
  fake = stackIncus();
  fake.extensions = [...REQUIRED_EXTENSIONS];
  fake.projectConfig = {
    'features.images': 'true',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
  };
  // The custody check walks real ancestors.
  workspace = realpathSync(mkdtempSync(join(tmpdir(), 'tale-incus-doctor-')));
  connects = [];
});

afterEach(() => {
  warn.mockRestore();
  fake.close();
  rmSync(workspace, { recursive: true, force: true });
});

/** The workspace's `.tale/incus/`, private and pinnable. */
function writeCredentials(): void {
  if (made === undefined) throw new Error('the certificates were not made');
  const target = join(workspace, '.tale', 'incus');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  chmodSync(target, 0o700);
  for (const [name, content] of [
    ['client.crt', made.client.cert],
    ['client.key', made.client.key],
    ['server.crt', made.server.cert],
  ] as const)
    writeFileSync(join(target, name), content, { mode: 0o600 });
}

function options(
  overrides: Partial<IncusDoctorOptions> = {},
): IncusDoctorOptions {
  return {
    projectDir: workspace,
    stack: 'tale',
    declaration,
    offline: false,
    environment: {},
    connect: (_tls, endpoint) => {
      connects.push(endpoint);
      return clientOf(fake);
    },
    ...overrides,
  };
}

function seed(
  name: string,
  status: 'Running' | 'Stopped',
  config: Record<string, string> = {},
  consoleLog = '',
): void {
  fake.seedInstance(
    name,
    {
      'user.tale.stack': 'tale',
      'user.tale.service': name,
      'user.tale.role': name,
      'user.tale.want': 'running',
      ...config,
    },
    { ephemeral: false, status, devices: {} },
  ).consoleLog = consoleLog;
}

describePosix('tale doctor on an Incus workspace', () => {
  test('missing credentials fail, and the API is not dialled', async () => {
    const checks = await collectIncusChecks(options());
    expect(checks.map(({ id, status }) => [id, status])).toEqual([
      ['incus-credentials', 'fail'],
      ['incus-api', 'warn'],
    ]);
    expect(checks[0]?.detail).toContain(join(workspace, '.tale', 'incus'));
    expect(connects).toEqual([]);
  });

  test('offline makes no network call and says what it skipped', async () => {
    writeCredentials();
    const checks = await collectIncusChecks(options({ offline: true }));
    expect(checks.map(({ id, status }) => [id, status])).toEqual([
      ['incus-credentials', 'warn'],
      ['incus-api', 'warn'],
    ]);
    expect(checks[0]?.detail).toContain('valid until');
    expect(checks[0]?.fix).toContain('Renew');
    expect(checks[1]?.detail).toContain('--offline');
    expect(checks[1]?.detail).toContain('https://10.30.0.1:8443');
    expect(connects).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  test('a ready node and a healthy stack pass, at the declared endpoint', async () => {
    writeCredentials();
    seed('db', 'Running');
    const checks = await collectIncusChecks(
      options({
        declaration: { ...declaration, endpoint: 'https://192.0.2.7:8443' },
      }),
    );
    expect(checks.map(({ id, status }) => [id, status])).toEqual([
      ['incus-credentials', 'warn'],
      ['incus-api', 'ok'],
      ['incus-instances', 'ok'],
    ]);
    expect(connects).toEqual(['https://192.0.2.7:8443']);
    expect(checks[1]?.detail).toContain('pool tale (zfs)');
    expect(checks[2]?.detail).toContain('None of the 1 instances');
  });

  test('every probe refusal and warning is its own row', async () => {
    writeCredentials();
    fake.extensions = REQUIRED_EXTENSIONS.filter(
      (name) => name !== 'instance_auto_restart',
    );
    fake.projectConfig = { ...fake.projectConfig, restricted: 'false' };
    const checks = await collectIncusChecks(options());
    const api = checks.filter((check) => check.id === 'incus-api');
    expect(api.map((check) => check.status)).toEqual(['fail', 'warn']);
    expect(api[0]?.detail).toContain('instance_auto_restart');
    expect(api[1]?.detail).toContain('not restricted');
  });

  test('an API that does not answer fails with the endpoint', async () => {
    writeCredentials();
    const checks = await collectIncusChecks(
      options({
        connect: (_tls, endpoint) =>
          new IncusClient({
            endpoint,
            project: declaration.project,
            tls: { ca: 'ca', cert: 'cert', key: 'key' },
            signal: () => undefined,
            fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
            sleep: async () => undefined,
          }),
      }),
    );
    expect(checks.at(-1)).toMatchObject({
      id: 'incus-api',
      status: 'fail',
    });
    expect(checks.at(-1)?.detail).toContain('https://10.30.0.1:8443');
    expect(checks.at(-1)?.detail).toContain('ECONNREFUSED');
  });

  test('an instance stopped after repeated crashes fails with the console Incus kept; a running console is never read', async () => {
    writeCredentials();
    seed('worker', 'Stopped', {}, 'boot\npanic: no database\n');
    seed('api', 'Running', {}, 'serving\n');
    seed('backup', 'Stopped', { 'user.tale.want': 'stopped' }, 'done\n');
    seed('job-x', 'Stopped', { 'user.tale.role': 'helper' }, 'helper\n');
    seed('other', 'Stopped', { 'user.tale.stack': 'other' }, 'other\n');
    const checks = await collectIncusChecks(options());
    const instances = checks.filter((check) => check.id === 'incus-instances');
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      status: 'fail',
      lines: [
        'the last console lines Incus kept:',
        'boot',
        'panic: no database',
      ],
    });
    expect(instances[0]?.detail).toContain(
      'worker stopped after repeated crashes',
    );
    expect(instances[0]?.fix).toContain(
      'incus start worker --project tale-stack',
    );
    expect(fake.seen('GET /1.0/instances/api/console')).toEqual([]);
    expect(fake.instances.get('api')?.consoleLog).toBe('serving\n');
    for (const name of ['backup', 'job-x', 'other'])
      expect(fake.seen(`GET /1.0/instances/${name}/console`)).toEqual([]);
  });

  test('a stack with no instances yet says so', async () => {
    writeCredentials();
    const checks = await collectIncusChecks(options());
    expect(checks.at(-1)).toMatchObject({
      id: 'incus-instances',
      status: 'ok',
    });
    expect(checks.at(-1)?.detail).toContain('no instances');
  });
});
