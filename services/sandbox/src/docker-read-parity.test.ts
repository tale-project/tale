// Each read the Engine API answers prints what the docker CLI prints for its
// --format template. PRINTED holds the templates and what docker CLI 29.9.0
// printed for these fixtures, asked through the stub daemon's socket. A
// template or renderer changed since fails here until it is captured again:
// with TALE_DOCKER_CLI_PARITY=1 and a docker CLI on PATH (no daemon needed),
// the same comparisons also run live against that CLI, which prints what to
// copy into PRINTED.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SESSION_LISTING,
  SESSION_READS,
} from './backend/docker/docker-session-backend.ts';
import { SESSION_INVENTORY } from './capacity.ts';
import { type EngineStub, startEngineStub } from './docker-engine-stub.ts';
import {
  containerInspect,
  containerListing,
  forgetEngineVersions,
  type DockerRead,
} from './docker-engine.ts';
import { SESSION_ORGANIZATION } from './package-cache-retention.ts';
import { runDocker } from './spawn-util.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

/** Inspect documents, by the session container name each answers to. */
const CONTAINERS = {
  // A running agent session with every label and both mounts.
  'tale-sbx-ses-running': {
    Id: A,
    Created: '2026-10-30T07:22:23.576123456Z',
    Name: '/tale-sbx-ses-running',
    State: { Status: 'running', Running: true, OOMKilled: false },
    Config: {
      Labels: {
        'tale.created': '1700000000000',
        'tale.create-attempt': '0b6f3f0e-6a59-4d5c-9b7a-2f1a8f0c2b11',
        'tale.sandbox-instance': 'device-7',
        'tale.docker': 'true',
        'tale.org': 'org_a',
      },
    },
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/lib/tale-sandbox/sessions/ses-running',
        Destination: '/agent',
      },
      {
        Type: 'volume',
        Source: '/var/lib/docker/volumes/tale-dind-running/_data',
        Destination: '/var/lib/docker',
      },
    ],
  },
  // A dead one the OOM killer hit: an empty label, no mounts.
  'tale-sbx-ses-oom': {
    Id: B,
    Created: '2026-10-29T23:59:59Z',
    Name: '/tale-sbx-ses-oom',
    State: { Status: 'exited', Running: false, OOMKilled: true },
    Config: { Labels: { 'tale.created': '', 'tale.docker': 'false' } },
    Mounts: [],
  },
  // A container without labels or mounts. The CLI answers a template that
  // names `.Id` from the raw JSON, where `index` of the null label map
  // fails, so only the other reads are compared on it.
  'tale-sbx-ses-created': {
    Id: C,
    Created: '2026-10-30T06:00:00.000000001Z',
    Name: '/tale-sbx-ses-created',
    State: { Status: 'created', Running: false, OOMKilled: false },
    Config: { Labels: null },
    Mounts: null,
  },
  // A colour-rooted legacy mount; a label holding characters JSON escapes.
  'tale-sbx-ses-legacy': {
    Id: D,
    Created: '2026-01-02T03:04:05.06Z',
    Name: '/tale-sbx-ses-legacy',
    State: { Status: 'paused', Running: true, OOMKilled: false },
    Config: {
      Labels: {
        'tale.created': '1699999999999',
        'tale.sandbox-instance': '',
        'tale.create-attempt': 'a<b>&c',
      },
    },
    Mounts: [
      {
        Type: 'bind',
        Source: '/var/lib/tale-sandbox/sessions/blue/ses-legacy',
        Destination: '/agent',
      },
      { Type: 'tmpfs', Source: '', Destination: '/tmp' },
    ],
  },
} as const;

/** The daemon's container listing, newest first. */
const LISTING = [
  {
    Id: A,
    State: 'running',
    Labels: {
      'tale.sandbox-session': '1',
      'tale.session': 'ses-running',
      'tale.org': 'org_a',
      'tale.profile': 'agent',
      'tale.created': '1700000000000',
      'tale.sandbox-instance': 'device-7',
      'tale.docker': 'true',
      'tale.egress-ip': '172.30.0.5',
    },
  },
  {
    Id: B,
    State: 'exited',
    Labels: {
      'tale.sandbox-session': '1',
      'tale.session': 'ses-oom',
      'tale.org': 'org_<b>&\u2028',
      'tale.profile': 'default',
      'tale.created': '',
    },
  },
  {
    Id: C,
    State: 'created',
    Labels: {
      'tale.sandbox-session': '1',
      'tale.session': 'ses-created',
      'tale.org': 'org_a',
    },
  },
  { Id: D, State: 'running', Labels: null },
];

type ContainerName = keyof typeof CONTAINERS;

type ReadName = keyof typeof SESSION_READS;

function isReadName(name: string): name is ReadName {
  return name in SESSION_READS;
}

const READ_NAMES = Object.keys(SESSION_READS).filter(isReadName);

/** What docker CLI 29.9.0 printed for each session read's template. */
const PRINTED: Record<
  ReadName,
  { template: string; printed: Partial<Record<ContainerName, string>> }
> = {
  workspaceMount: {
    template:
      '{{range .Mounts}}{{if eq .Destination "/agent"}}{{.Source}}{{end}}{{end}}',
    printed: {
      'tale-sbx-ses-running': '/var/lib/tale-sandbox/sessions/ses-running\n',
      'tale-sbx-ses-oom': '\n',
      'tale-sbx-ses-created': '\n',
      'tale-sbx-ses-legacy': '/var/lib/tale-sandbox/sessions/blue/ses-legacy\n',
    },
  },
  runningState: {
    template:
      '{{.State.Running}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}\t{{.State.OOMKilled}}',
    printed: {
      'tale-sbx-ses-running': 'true\t1700000000000\tfalse\n',
      'tale-sbx-ses-oom': 'false\t\ttrue\n',
      'tale-sbx-ses-created': 'false\t\tfalse\n',
      'tale-sbx-ses-legacy': 'true\t1699999999999\tfalse\n',
    },
  },
  status: {
    template: '{{.State.Status}}',
    printed: {
      'tale-sbx-ses-running': 'running\n',
      'tale-sbx-ses-oom': 'exited\n',
      'tale-sbx-ses-created': 'created\n',
      'tale-sbx-ses-legacy': 'paused\n',
    },
  },
  liveSession: {
    template:
      '{{.State.Status}}\t{{with index .Config.Labels "tale.sandbox-instance"}}{{.}}{{end}}',
    printed: {
      'tale-sbx-ses-running': 'running\tdevice-7\n',
      'tale-sbx-ses-oom': 'exited\t\n',
      'tale-sbx-ses-created': 'created\t\n',
      'tale-sbx-ses-legacy': 'paused\t\n',
    },
  },
  identity: {
    template: '{{.Id}}\t{{.State.Status}}',
    printed: {
      'tale-sbx-ses-running': `${A}\trunning\n`,
      'tale-sbx-ses-oom': `${B}\texited\n`,
      'tale-sbx-ses-created': `${C}\tcreated\n`,
      'tale-sbx-ses-legacy': `${D}\tpaused\n`,
    },
  },
  incarnation: {
    template:
      '{{.Id}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}',
    printed: {
      'tale-sbx-ses-running': `${A}\t1700000000000\n`,
      'tale-sbx-ses-oom': `${B}\t\n`,
      'tale-sbx-ses-legacy': `${D}\t1699999999999\n`,
    },
  },
  incarnationAttempt: {
    template:
      '{{.Id}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}\t{{with index .Config.Labels "tale.create-attempt"}}{{.}}{{end}}',
    printed: {
      'tale-sbx-ses-running': `${A}\t1700000000000\t0b6f3f0e-6a59-4d5c-9b7a-2f1a8f0c2b11\n`,
      'tale-sbx-ses-oom': `${B}\t\t\n`,
      'tale-sbx-ses-legacy': `${D}\t1699999999999\ta<b>&c\n`,
    },
  },
  removal: {
    template:
      '{{.Id}}\t{{with index .Config.Labels "tale.docker"}}{{.}}{{end}}\t{{range .Mounts}}{{if eq .Destination "/var/lib/docker"}}true{{end}}{{end}}',
    printed: {
      'tale-sbx-ses-running': `${A}\ttrue\ttrue\n`,
      'tale-sbx-ses-oom': `${B}\tfalse\t\n`,
      'tale-sbx-ses-legacy': `${D}\t\t\n`,
    },
  },
  stuckState: {
    template:
      '{{.Id}}\t{{with index .Config.Labels "tale.created"}}{{.}}{{end}}\t{{.State.Status}}\t{{.Created}}\t{{with index .Config.Labels "tale.docker"}}{{.}}{{end}}\t{{range .Mounts}}{{if eq .Destination "/var/lib/docker"}}true{{end}}{{end}}',
    printed: {
      'tale-sbx-ses-running': `${A}\t1700000000000\trunning\t2026-10-30T07:22:23.576123456Z\ttrue\ttrue\n`,
      'tale-sbx-ses-oom': `${B}\t\texited\t2026-10-29T23:59:59Z\tfalse\t\n`,
      'tale-sbx-ses-legacy': `${D}\t1699999999999\tpaused\t2026-01-02T03:04:05.06Z\t\t\n`,
    },
  },
};

const SESSION_ROW = `ses-running\torg_a\tagent\t1700000000000\trunning\tdevice-7\ttrue\t172.30.0.5\n`;

/** Each listing as its caller asks for it, with what the CLI printed. */
const LISTINGS: {
  name: string;
  read: DockerRead;
  template: string;
  printed: string;
}[] = [
  {
    name: 'listSessions',
    read: containerListing(
      ['--all', '--filter', 'label=tale.sandbox-session=1'],
      SESSION_LISTING,
    ),
    template:
      '{{.Label "tale.session"}}\t{{.Label "tale.org"}}\t{{.Label "tale.profile"}}\t{{.Label "tale.created"}}\t{{.State}}\t{{.Label "tale.sandbox-instance"}}\t{{.Label "tale.docker"}}\t{{.Label "tale.egress-ip"}}',
    printed: `${SESSION_ROW}ses-oom\torg_<b>&\u2028\tdefault\t\texited\t\t\t\nses-created\torg_a\t\t\tcreated\t\t\t\n`,
  },
  {
    name: 'listSessions of one instance and organization',
    read: containerListing(
      [
        '--all',
        '--filter',
        'label=tale.sandbox-session=1',
        '--filter',
        'label=tale.sandbox-instance=device-7',
        '--filter',
        'label=tale.org=org_a',
      ],
      SESSION_LISTING,
    ),
    template: SESSION_LISTING.template,
    printed: SESSION_ROW,
  },
  {
    name: 'running sessions only (no --all)',
    read: containerListing(
      ['--filter', 'label=tale.sandbox-session=1'],
      SESSION_LISTING,
    ),
    template: SESSION_LISTING.template,
    printed: SESSION_ROW,
  },
  {
    name: 'the capacity inventory',
    read: containerListing(
      ['--all', '--filter', 'label=tale.sandbox-session=1'],
      SESSION_INVENTORY,
    ),
    template:
      '{"sessionId":{{json (.Label "tale.session")}},"organizationId":{{json (.Label "tale.org")}},"state":{{json .State}},"instance":{{json (.Label "tale.sandbox-instance")}}}',
    printed:
      '{"sessionId":"ses-running","organizationId":"org_a","state":"running","instance":"device-7"}\n' +
      '{"sessionId":"ses-oom","organizationId":"org_<b>&\\u2028","state":"exited","instance":""}\n' +
      '{"sessionId":"ses-created","organizationId":"org_a","state":"created","instance":""}\n',
  },
  {
    name: 'the organizations holding package caches',
    read: containerListing(
      ['--all', '--no-trunc', '--filter', 'label=tale.sandbox-session=1'],
      SESSION_ORGANIZATION,
    ),
    template: '{{.Label "tale.org"}}',
    printed: 'org_a\norg_<b>&\u2028\norg_a\n',
  },
  {
    name: 'the package caches of one organization',
    read: containerListing(
      [
        '--all',
        '--no-trunc',
        '--filter',
        'label=tale.sandbox-session=1',
        '--filter',
        'label=tale.org=org_a',
      ],
      SESSION_ORGANIZATION,
    ),
    template: SESSION_ORGANIZATION.template,
    printed: 'org_a\norg_a\n',
  },
];

const ENV_KEYS = ['DOCKER_BIN', 'DOCKER_HOST', 'DOCKER_CONTEXT'] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

let stub: EngineStub;

beforeAll(async () => {
  stub = await startEngineStub();
  for (const [name, document] of Object.entries(CONTAINERS)) {
    stub.containers.set(name, document);
  }
  stub.listing = LISTING;
});

afterAll(async () => {
  await stub.stop();
});

beforeEach(() => {
  forgetEngineVersions();
  delete process.env.DOCKER_BIN;
  delete process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = `unix://${stub.socket}`;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function viaEngine(read: DockerRead): Promise<string> {
  const result = await runDocker(read.args, { engine: read.engine });
  expect(result.exitCode).toBe(0);
  return result.stdout;
}

describe('a session read prints from the Engine API what the CLI printed for its template', () => {
  test.each(READ_NAMES)('%s', async (name) => {
    const { template, printed } = PRINTED[name];
    expect(SESSION_READS[name].template).toBe(template);
    for (const [container, expected] of Object.entries(printed)) {
      expect(
        await viaEngine(containerInspect(container, SESSION_READS[name])),
      ).toBe(expected);
    }
  });
});

describe('a session listing prints from the Engine API what the CLI printed for its template', () => {
  test.each(LISTINGS.map((listing) => [listing.name, listing] as const))(
    '%s',
    async (_name, listing) => {
      expect(listing.read.args.at(-1)).toBe(listing.template);
      expect(await viaEngine(listing.read)).toBe(listing.printed);
    },
  );
});

describe.skipIf(process.env.TALE_DOCKER_CLI_PARITY !== '1')(
  'live: the docker CLI on PATH prints the same (TALE_DOCKER_CLI_PARITY=1)',
  () => {
    let config: string;

    beforeAll(async () => {
      config = await mkdtemp(join(tmpdir(), 'tale-docker-cli-parity-'));
    });

    afterAll(async () => {
      await rm(config, { recursive: true, force: true });
    });

    async function viaCli(read: DockerRead): Promise<string> {
      const proc = Bun.spawn(['docker', ...read.args], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: config,
          DOCKER_CONFIG: config,
          DOCKER_HOST: `unix://${stub.socket}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      expect({ exitCode: await proc.exited, stderr }).toEqual({
        exitCode: 0,
        stderr: '',
      });
      return stdout;
    }

    test.each(READ_NAMES)('%s', async (name) => {
      for (const container of Object.keys(PRINTED[name].printed)) {
        const read = containerInspect(container, SESSION_READS[name]);
        const printed = await viaCli(read);
        console.log(`${name} ${container}: ${JSON.stringify(printed)}`);
        expect(await viaEngine(read)).toBe(printed);
      }
    });

    test.each(LISTINGS.map((listing) => [listing.name, listing] as const))(
      '%s',
      async (_name, listing) => {
        const printed = await viaCli(listing.read);
        console.log(`${listing.name}: ${JSON.stringify(printed)}`);
        expect(await viaEngine(listing.read)).toBe(printed);
      },
    );
  },
);
