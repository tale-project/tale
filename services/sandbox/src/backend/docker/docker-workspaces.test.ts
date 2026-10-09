// The Docker backend's half of the platform's workspace cleanup: the workspace
// inventory, the organizations holding resources beyond their workspaces, and
// the teardown of a deleted organization's build helpers and caches. Driven end
// to end against a FAKE Docker CLI — `DOCKER_BIN` points at a Bun script that
// answers from a JSON state file beside it (label filters and the Go-template
// placeholders the spawner uses) and records every call — so the joins, the
// ownership checks and the removal order run their real code paths without a
// daemon. spawn-util reads DOCKER_BIN lazily per call, so the override works
// after import.

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildkitdCacheVolumeName,
  buildkitdContainerName,
  buildkitdMirrorContainerName,
  buildkitdMirrorVolumeName,
  buildkitdNetworkName,
  MIRROR_REGISTRIES,
  removeOrganizationBuildkit,
  retainBuildkitd,
} from '../../buildkitd.ts';
import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import { DockerSessionBackend } from './docker-session-backend.ts';

const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
const a = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
function done(output = '') {
  writeFileSync(path, JSON.stringify(s));
  if (output !== '') console.log(output);
  process.exit(0);
}
function fail(message) { console.error(message); process.exit(1); }
if (s.failing.some((prefix) => a.join(' ').startsWith(prefix))) {
  fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
}
function flag(name) { return a.find((_, i) => a[i - 1] === name); }
function selected(labels) {
  const own = labels ?? {};
  return a.filter((_, i) => a[i - 1] === '--filter').every((filter) => {
    if (!filter.startsWith('label=')) fail('Unhandled fake docker filter: ' + filter);
    const [key, ...value] = filter.slice('label='.length).split('=');
    return value.length === 0 ? key in own : own[key] === value.join('=');
  });
}
function render(object) {
  return flag('--format')
    .replace(/\{\{json \.(\w+)\}\}/g, (_, key) => JSON.stringify(object[key] ?? null))
    .replace(/\{\{\.Label "([^"]+)"\}\}/g, (_, key) => (object.Labels ?? {})[key] ?? '')
    .replace(/\{\{\.(\w+)\}\}/g, (_, key) => String(object[key] ?? ''));
}
function list(objects) {
  done(objects.filter((object) => selected(object.Labels)).map(render).join('\n'));
}
function network(ref) {
  const name = Object.keys(s.networks).find((key) => key === ref || s.networks[key].Id === ref);
  if (name === undefined) fail('Error response from daemon: network ' + ref + ' not found');
  return name;
}
const [command, sub] = a;
if (command === 'ps') {
  list(s.containers
    .filter((container) => a.includes('--all') || container.State === 'running')
    .map((container) => ({ ...container, ID: a.includes('--no-trunc') ? container.ID : container.ID.slice(0, 12) })));
}
if (command === 'rm') {
  const target = a.at(-1);
  const index = s.containers.findIndex((container) => container.ID === target || container.Names === target);
  if (index < 0) fail('Error response from daemon: No such container: ' + target);
  const [removed] = s.containers.splice(index, 1);
  // Like Docker, removing a container drops its network endpoints.
  for (const attached of Object.values(s.networks)) delete attached.Containers[removed.ID];
  done(target);
}
if (command === 'volume' && sub === 'ls') {
  list(Object.entries(s.volumes).map(([Name, Labels]) => ({ Name, Labels })));
}
if (command === 'volume' && (sub === 'inspect' || sub === 'rm')) {
  const name = a.at(-1);
  if (!(name in s.volumes)) fail('Error response from daemon: get ' + name + ': no such volume');
  if (sub === 'inspect') done(render({ Name: name, Labels: s.volumes[name] }));
  if (s.volumesInUse.includes(name)) fail('Error response from daemon: remove ' + name + ': volume is in use');
  delete s.volumes[name];
  done(name);
}
if (command === 'network' && sub === 'ls') {
  list(Object.entries(s.networks).map(([Name, attached]) => ({ ...attached, Name, ID: attached.Id.slice(0, 12) })));
}
if (command === 'network' && sub === 'inspect') {
  const name = network(a.at(-1));
  done(render({ ...s.networks[name], Name: name }));
}
if (command === 'network' && sub === 'disconnect') {
  const [ref, container] = a.slice(-2);
  const name = network(ref);
  if (!(container in s.networks[name].Containers)) {
    fail('Error response from daemon: container ' + container + ' is not connected to network ' + name);
  }
  delete s.networks[name].Containers[container];
  done();
}
if (command === 'network' && sub === 'rm') {
  const name = network(a.at(-1));
  if (Object.keys(s.networks[name].Containers).length > 0) {
    fail('Error response from daemon: error while removing network: network ' + name + ' has active endpoints');
  }
  delete s.networks[name];
  done(a.at(-1));
}
fail('Unhandled fake docker call: ' + JSON.stringify(a));
`;

interface FakeContainer {
  ID: string;
  Names: string;
  State: string;
  Labels: Record<string, string>;
}

interface FakeNetwork {
  Id: string;
  Labels: Record<string, string>;
  Containers: Record<string, { Name: string }>;
}

interface FakeState {
  containers: FakeContainer[];
  volumes: Record<string, Record<string, string> | null>;
  networks: Record<string, FakeNetwork>;
  /** Volumes a container still mounts: `volume rm` refuses them. */
  volumesInUse: string[];
  /** A call whose argv starts with one of these fails like a daemon outage. */
  failing: string[];
}

let root = '';
const ORIGINAL_DOCKER_BIN = process.env.DOCKER_BIN;

function emptyState(): FakeState {
  return {
    containers: [],
    volumes: {},
    networks: {},
    volumesInUse: [],
    failing: [],
  };
}

async function save(snapshot: FakeState): Promise<void> {
  await writeFile(join(root, 'state.json'), JSON.stringify(snapshot));
}

async function state(): Promise<FakeState> {
  return JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
}

async function calls(): Promise<string[][]> {
  const lines = (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim();
  return lines ? lines.split('\n').map((line) => JSON.parse(line)) : [];
}

async function resetCalls(): Promise<void> {
  await writeFile(join(root, 'calls.jsonl'), '');
}

/** The rejection of a promise, or null when it resolved — bun:test's
 * `rejects` matchers type as void, which the await-thenable lint rejects. */
async function rejection(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** A stable, full-length Docker object id. */
function hexId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

function backendConfig(overrides: Partial<SpawnerConfig> = {}): SpawnerConfig {
  return {
    backend: 'docker',
    instance: '',
    hub: null,
    deviceConfigPath: null,
    port: 8003,
    sandboxToken: 'test-token',
    runtimeImage: 'tale-sandbox-runtime:test',
    runtimeTier: 'sysbox',
    dockerInContainer: true,
    dockerBuildCache: true,
    buildkitdImage: 'tale-sandbox-buildkitd:test',
    buildkitdMirrorImage: 'registry:2',
    transparentEgress: true,
    k8s: {
      namespace: 'tale-sandbox',
      runtimeClassName: null,
      workspaceSizeLimit: '4Gi',
    },
    maxTimeoutMs: 300_000,
    hostSessionRoot: join(root, 'no-sessions'),
    cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
    egressNetwork: 'tale-sandbox-net',
    egressProxy: 'http://sandbox-egress:3128',
    stdoutMaxBytes: 5_242_880,
    stderrMaxBytes: 5_242_880,
    maxRequestBodyBytes: 262_144,
    session: TEST_SESSION_CONFIG,
    ...overrides,
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tale-docker-workspaces-'));
  const executable = join(root, 'docker');
  await writeFile(executable, FAKE_DOCKER);
  await chmod(executable, 0o755);
  process.env.DOCKER_BIN = executable;
});

beforeEach(async () => {
  await save(emptyState());
  await resetCalls();
});

afterAll(async () => {
  if (ORIGINAL_DOCKER_BIN === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = ORIGINAL_DOCKER_BIN;
  await rm(root, { recursive: true, force: true });
});

function sessionContainer(
  sessionId: string,
  containerState: string,
  organizationId?: string,
): FakeContainer {
  return {
    ID: hexId(`session:${sessionId}`),
    Names: `tale-sbx-ses-${sessionId}`,
    State: containerState,
    Labels: {
      'tale.sandbox-session': '1',
      'tale.session': sessionId,
      'tale.profile': 'agent',
      'tale.created': '1700000000000',
      ...(organizationId === undefined ? {} : { 'tale.org': organizationId }),
    },
  };
}

function owned(organizationId: string): Record<string, string> {
  return { 'tale.buildkitd': '1', 'tale.org': organizationId };
}

describe('DockerSessionBackend.listWorkspaces', () => {
  test('joins every workspace dir with the session container beside it', async () => {
    const hostSessionRoot = await mkdtemp(join(root, 'sessions-'));
    for (const dir of ['ses-a', 'ses-b', 'ses-c', 'ses-e', 'ses-f']) {
      await mkdir(join(hostSessionRoot, dir));
    }
    // A stopped session from the colour-rooted layout.
    await mkdir(join(hostSessionRoot, 'blue', 'ses-d'), { recursive: true });
    await mkdir(join(hostSessionRoot, '.pins'));
    await writeFile(join(hostSessionRoot, '.pins', 'a.pinned'), '1\n');
    await writeFile(join(hostSessionRoot, '.pins', 'c.pinned'), '1\n');
    // The organization a workspace was created for, kept beside it: what
    // names a stopped one. A container's own label wins; a marker that is
    // no organization id names nobody.
    await mkdir(join(hostSessionRoot, '.owners'));
    await writeFile(join(hostSessionRoot, '.owners', 'a.org'), 'org_other\n');
    await writeFile(join(hostSessionRoot, '.owners', 'c.org'), 'org_c\n');
    await writeFile(join(hostSessionRoot, '.owners', 'd.org'), '../org d\n');
    await writeFile(join(hostSessionRoot, '.owners', 'f.org'), 'org_f\n');

    const seeded = emptyState();
    seeded.containers.push(
      sessionContainer('a', 'running', 'org_a'),
      sessionContainer('b', 'exited', 'org_b'),
      // Still starting: nothing has ended, so the workspace is in use.
      sessionContainer('e', 'created', 'org_e'),
      // Ended for good, and from a build that recorded no organization.
      sessionContainer('f', 'dead'),
      // A container without a workspace dir here is not a workspace.
      sessionContainer('g', 'running', 'org_g'),
      {
        ID: hexId('helper'),
        Names: buildkitdContainerName('org_a'),
        State: 'running',
        Labels: owned('org_a'),
      },
    );
    await save(seeded);

    const backend = new DockerSessionBackend(
      backendConfig({ hostSessionRoot }),
    );
    const workspaces = (await backend.listWorkspaces()).sort((x, y) =>
      x.sessionId.localeCompare(y.sessionId),
    );

    const touchedAtMs = expect.any(Number);
    expect(workspaces).toStrictEqual([
      {
        sessionId: 'a',
        touchedAtMs,
        active: true,
        pinned: true,
        organizationId: 'org_a',
      },
      {
        sessionId: 'b',
        touchedAtMs,
        active: false,
        pinned: false,
        organizationId: 'org_b',
      },
      {
        sessionId: 'c',
        touchedAtMs,
        active: false,
        pinned: true,
        organizationId: 'org_c',
      },
      { sessionId: 'd', touchedAtMs, active: false, pinned: false },
      {
        sessionId: 'e',
        touchedAtMs,
        active: true,
        pinned: false,
        organizationId: 'org_e',
      },
      {
        sessionId: 'f',
        touchedAtMs,
        active: false,
        pinned: false,
        organizationId: 'org_f',
      },
    ]);
    for (const workspace of workspaces) {
      expect(workspace.touchedAtMs).toBeGreaterThan(0);
    }
    // One read-only listing of the session containers, never a mutation.
    expect(await calls()).toEqual([
      [
        'ps',
        '--all',
        '--filter',
        'label=tale.sandbox-session=1',
        '--format',
        '{{.Label "tale.session"}}\t{{.Label "tale.org"}}\t{{.Label "tale.profile"}}\t{{.Label "tale.created"}}\t{{.State}}\t{{.Label "tale.sandbox-instance"}}\t{{.Label "tale.docker"}}\t{{.Label "tale.egress-ip"}}',
      ],
    ]);
  });

  test('THROWS when the session containers cannot be listed, instead of reading every workspace as inactive', async () => {
    const hostSessionRoot = await mkdtemp(join(root, 'sessions-'));
    await mkdir(join(hostSessionRoot, 'ses-live'));
    const seeded = emptyState();
    seeded.containers.push(sessionContainer('live', 'running', 'org_live'));
    seeded.failing = ['ps'];
    await save(seeded);

    const backend = new DockerSessionBackend(
      backendConfig({ hostSessionRoot }),
    );
    const error = await rejection(backend.listWorkspaces());
    expect(error?.message).toMatch(/docker ps \(sessions\) failed \(exit 1\)/);
    expect(error?.message).toMatch(/Cannot connect to the Docker daemon/);
  });
});

describe('DockerSessionBackend.listOrganizationResources', () => {
  // One configured prefix extends another: `tale-cache-npm-org_npm` must read
  // as org_npm under the npm prefix, never as `npm-org_npm` under pip's.
  const prefixes = {
    pip: 'tale-cache',
    npm: 'tale-cache-npm',
    bun: 'tale-sandbox-bun-cache',
  };
  const cache = { 'tale.sandbox-cache': '1' };

  function inventoryState(): FakeState {
    const seeded = emptyState();
    seeded.volumes = {
      'tale-cache-org_pip': cache,
      'tale-cache-npm-org_npm': cache,
      'tale-sandbox-bun-cache-org_bun': cache,
      // Carries the cache label under no configured prefix.
      'scratch-volume': cache,
      // A configured prefix without the cache label is not a package cache.
      'tale-cache-org_unlabelled': null,
      [buildkitdCacheVolumeName('org_volume_only')]: owned('org_volume_only'),
      // The legacy global cache belongs to no organization.
      'tale-buildkitd-cache': { 'tale.buildkitd': '1' },
    };
    seeded.containers.push(
      {
        ID: hexId('builder:org_build'),
        Names: buildkitdContainerName('org_build'),
        State: 'exited',
        Labels: owned('org_build'),
      },
      {
        // An organization that also holds a package cache is reported once.
        ID: hexId('builder:org_pip'),
        Names: buildkitdContainerName('org_pip'),
        State: 'running',
        Labels: owned('org_pip'),
      },
      {
        ID: hexId('legacy-builder'),
        Names: 'tale-buildkitd',
        State: 'exited',
        Labels: { 'tale.buildkitd': '1' },
      },
      {
        ID: hexId('odd-label'),
        Names: 'odd-label',
        State: 'running',
        Labels: { 'tale.buildkitd': '1', 'tale.org': 'not an org!' },
      },
      // Sessions are workspaces, not resources beyond them.
      sessionContainer('s1', 'running', 'org_session_only'),
    );
    seeded.networks[buildkitdNetworkName('org_network_only')] = {
      Id: hexId('network:org_network_only'),
      Labels: owned('org_network_only'),
      Containers: {},
    };
    return seeded;
  }

  test('reports the sorted union of package-cache and build-helper organizations', async () => {
    await save(inventoryState());
    const backend = new DockerSessionBackend(
      backendConfig({ cacheVolumePrefix: prefixes }),
    );
    expect(await backend.listOrganizationResources()).toEqual([
      'org_build',
      'org_bun',
      'org_network_only',
      'org_npm',
      'org_pip',
      'org_volume_only',
    ]);
    // Inventory only.
    expect(
      (await calls()).every((args) => args[0] === 'ps' || args[1] === 'ls'),
    ).toBe(true);
  });

  test.each([
    ['volume ls', /volume: cannot list cache volumes/],
    ['network ls', /buildkitd: cannot inventory organization resources/],
    ['ps', /buildkitd: cannot inventory organization resources/],
  ])(
    'THROWS when an inventory cannot be read (%s)',
    async (failing, message) => {
      const seeded = inventoryState();
      seeded.failing = [failing];
      await save(seeded);
      const backend = new DockerSessionBackend(
        backendConfig({ cacheVolumePrefix: prefixes }),
      );
      const error = await rejection(backend.listOrganizationResources());
      expect(error?.message).toMatch(message);
      expect(error?.message).toMatch(/Cannot connect to the Docker daemon/);
    },
  );
});

describe('DockerSessionBackend.teardownOrganization', () => {
  const ORG = 'org_gone';
  const OTHER = 'org_kept';
  const EGRESS_ID = hexId('sandbox-egress');
  const CACHE_LABELS = { 'tale.sandbox-cache': '1' };
  const STRANGER = 'tale-buildkitd-lookalike';

  function helperNames(organizationId: string): string[] {
    return [
      buildkitdContainerName(organizationId),
      ...MIRROR_REGISTRIES.map((registry) =>
        buildkitdMirrorContainerName(organizationId, registry),
      ),
    ];
  }

  function buildVolumes(organizationId: string): string[] {
    return [
      buildkitdCacheVolumeName(organizationId),
      ...MIRROR_REGISTRIES.map((registry) =>
        buildkitdMirrorVolumeName(organizationId, registry),
      ),
    ];
  }

  function cacheVolumes(organizationId: string): string[] {
    return ['pip', 'npm', 'bun'].map((prefix) => `${prefix}-${organizationId}`);
  }

  /** Two organizations' build helpers — attached to their private network
   * beside the egress proxy — their build and package-cache volumes, and a
   * container labelled for the deleted organization under a name its ensure
   * never creates. */
  function organizationState(): FakeState {
    const seeded = emptyState();
    for (const organizationId of [ORG, OTHER]) {
      const attached: FakeNetwork['Containers'] = {
        [EGRESS_ID]: { Name: 'tale-sandbox-egress-1' },
      };
      for (const name of helperNames(organizationId)) {
        seeded.containers.push({
          ID: hexId(name),
          Names: name,
          State: 'running',
          Labels: owned(organizationId),
        });
        attached[hexId(name)] = { Name: name };
      }
      seeded.networks[buildkitdNetworkName(organizationId)] = {
        Id: hexId(buildkitdNetworkName(organizationId)),
        Labels: owned(organizationId),
        Containers: attached,
      };
      for (const volume of buildVolumes(organizationId)) {
        seeded.volumes[volume] = owned(organizationId);
      }
      for (const volume of cacheVolumes(organizationId)) {
        seeded.volumes[volume] = { ...CACHE_LABELS };
      }
    }
    seeded.containers.push({
      ID: hexId(STRANGER),
      Names: STRANGER,
      State: 'running',
      Labels: owned(ORG),
    });
    return seeded;
  }

  function withoutOrganization(seeded: FakeState): FakeState {
    const helpers = helperNames(ORG);
    const expected = structuredClone(seeded);
    expected.containers = expected.containers.filter(
      (container) => !helpers.includes(container.Names),
    );
    delete expected.networks[buildkitdNetworkName(ORG)];
    for (const volume of [...buildVolumes(ORG), ...cacheVolumes(ORG)]) {
      delete expected.volumes[volume];
    }
    return expected;
  }

  function rows(commands: string[][]): string[] {
    return commands.map((args) => args.join(' ')).sort();
  }

  test('removes the helpers by id, detaches and removes the network, then every volume; a second pass finds nothing', async () => {
    const seeded = organizationState();
    await save(seeded);
    const backend = new DockerSessionBackend(backendConfig());

    expect(await backend.teardownOrganization(ORG)).toEqual({
      containers: 4,
      volumes: 7,
      networks: 1,
    });

    const expected = withoutOrganization(seeded);
    // The stranger and the other organization are untouched, and so is the
    // egress proxy's attachment to the other organization's network.
    expect(await state()).toEqual(expected);

    const commands = await calls();
    // By immutable id, and only the organization's own helper names.
    expect(rows(commands.filter((args) => args[0] === 'rm'))).toEqual(
      rows(helperNames(ORG).map((name) => ['rm', '--force', hexId(name)])),
    );
    expect(commands.some((args) => args.includes(hexId(STRANGER)))).toBe(false);
    // The helpers' own endpoints went with them, so only the egress proxy is
    // detached — and before the network, by its id, is removed.
    const networkId = hexId(buildkitdNetworkName(ORG));
    const detaches = commands.filter((args) => args[1] === 'disconnect');
    expect(detaches).toEqual([
      ['network', 'disconnect', '--force', networkId, EGRESS_ID],
    ]);
    const detachAt = commands.findIndex((args) => args[1] === 'disconnect');
    const networkRmAt = commands.findIndex(
      (args) => args[0] === 'network' && args[1] === 'rm',
    );
    expect(commands[networkRmAt]).toEqual(['network', 'rm', networkId]);
    expect(detachAt).toBeLessThan(networkRmAt);
    expect(
      rows(commands.filter((args) => args[0] === 'volume' && args[1] === 'rm')),
    ).toEqual(
      rows(
        [...buildVolumes(ORG), ...cacheVolumes(ORG)].map((name) => [
          'volume',
          'rm',
          name,
        ]),
      ),
    );

    // Idempotent: the retry after a lost answer reports zeros and mutates
    // nothing, the stranger included.
    await resetCalls();
    expect(await backend.teardownOrganization(ORG)).toEqual({
      containers: 0,
      volumes: 0,
      networks: 0,
    });
    expect(await state()).toEqual(expected);
    expect(
      (await calls()).every(
        (args) => args[0] === 'ps' || args[1] === 'inspect',
      ),
    ).toBe(true);
  });

  const unownedBuildVolumeLabels: Record<
    string,
    Record<string, string> | null
  > = {
    'another organization': owned(OTHER),
    'no organization (a legacy global cache)': { 'tale.buildkitd': '1' },
    'no labels at all': null,
  };

  test.each(Object.keys(unownedBuildVolumeLabels))(
    'THROWS on a same-name build volume owned by %s and never removes it',
    async (owner) => {
      const labels = unownedBuildVolumeLabels[owner] ?? null;
      const seeded = organizationState();
      const name = buildkitdCacheVolumeName(ORG);
      seeded.volumes[name] = labels;
      await save(seeded);
      const backend = new DockerSessionBackend(backendConfig());

      const error = await rejection(backend.teardownOrganization(ORG));
      expect(error?.message).toMatch(
        /refusing foreign or unowned resource|invalid Docker resource metadata/,
      );
      expect((await state()).volumes[name]).toEqual(labels);
      expect(
        (await calls()).some(
          (args) =>
            args[0] === 'volume' && args[1] === 'rm' && args[2] === name,
        ),
      ).toBe(false);
    },
  );

  const uncachedLabels: Array<Record<string, string> | null> = [
    null,
    {},
    { 'tale.sandbox-cache': '0' },
  ];

  test.each(uncachedLabels)(
    'THROWS on a package-cache name without the cache label and never removes it (%j)',
    async (labels) => {
      const seeded = organizationState();
      const name = `npm-${ORG}`;
      seeded.volumes[name] = labels;
      await save(seeded);
      const backend = new DockerSessionBackend(backendConfig());

      const error = await rejection(backend.teardownOrganization(ORG));
      expect(error?.message).toBe(
        `volume: refusing to remove unlabelled volume ${name}`,
      );
      expect((await state()).volumes[name]).toEqual(labels);
      expect(
        (await calls()).some(
          (args) =>
            args[0] === 'volume' && args[1] === 'rm' && args[2] === name,
        ),
      ).toBe(false);
    },
  );

  test('THROWS while a package cache is still mounted; the retry finishes where it stopped', async () => {
    const seeded = organizationState();
    seeded.volumesInUse = [`pip-${ORG}`];
    await save(seeded);
    const backend = new DockerSessionBackend(backendConfig());

    expect(
      (await rejection(backend.teardownOrganization(ORG)))?.message,
    ).toMatch(/volume: cannot remove pip-org_gone: .*volume is in use/);
    expect((await state()).volumes[`pip-${ORG}`]).toEqual(CACHE_LABELS);

    const unmounted = await state();
    unmounted.volumesInUse = [];
    await save(unmounted);
    expect(await backend.teardownOrganization(ORG)).toEqual({
      containers: 0,
      volumes: 3,
      networks: 0,
    });
    expect(await state()).toEqual(withoutOrganization(organizationState()));
  });

  test('refuses an unsafe organization id before any Docker call', async () => {
    await save(organizationState());
    const backend = new DockerSessionBackend(backendConfig());
    expect(
      await rejection(backend.teardownOrganization('../org_gone')),
    ).not.toBeNull();
    expect(await calls()).toEqual([]);
  });
});

describe('removeOrganizationBuildkit', () => {
  test('refuses while a session create holds a lease on the helpers, and removes them once every lease is released', async () => {
    const org = 'org_leased';
    const seeded = emptyState();
    seeded.containers.push({
      ID: hexId(buildkitdContainerName(org)),
      Names: buildkitdContainerName(org),
      State: 'running',
      Labels: owned(org),
    });
    seeded.networks[buildkitdNetworkName(org)] = {
      Id: hexId(buildkitdNetworkName(org)),
      Labels: owned(org),
      Containers: {},
    };
    seeded.volumes[buildkitdCacheVolumeName(org)] = owned(org);
    await save(seeded);

    const first = retainBuildkitd(org);
    const second = retainBuildkitd(org);
    try {
      expect(
        (await rejection(removeOrganizationBuildkit(org)))?.message,
      ).toMatch(/still holds its build helpers/);
      // A release is idempotent: the second create still holds its lease.
      first();
      first();
      expect(
        (await rejection(removeOrganizationBuildkit(org)))?.message,
      ).toMatch(/still holds its build helpers/);
    } finally {
      first();
      second();
    }
    // Refused before touching Docker at all.
    expect(await calls()).toEqual([]);
    expect(await state()).toEqual(seeded);

    expect(await removeOrganizationBuildkit(org)).toEqual({
      containers: 1,
      volumes: 1,
      networks: 1,
    });
    expect(await state()).toEqual(emptyState());
  });
});
