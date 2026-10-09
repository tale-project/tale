import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
// The retention of the per-organization package caches against a fake docker
// CLI that keeps its volumes (label, the containers that mount them) and its
// session containers (their organization) in a state file: an organization's
// three volumes go once no session container of it exists and its recorded
// last use is older than the retention, never under a create that holds
// them, and a create that comes during a removal waits for it.
import { rejects } from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_PACKAGE_CACHE_RETENTION_MS,
  expirePackageCaches,
  makePackageCacheSweep,
  PACKAGE_CACHE_SWEEP_INTERVAL_MS,
  holdPackageCaches,
} from './package-cache-retention.ts';
import { ensureCacheVolume } from './volume.ts';

// `hold-<call>` makes the first such call wait until the test removes
// `holding-<call>`; `fail-<call>` makes the first such call fail.
const FAKE_DOCKER = String.raw`#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const dir = dirname(process.argv[1]);
const a = process.argv.slice(2);
const [command, sub] = a;
const call = command === 'volume' ? sub : command;
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(a) + '\n');
function gate(kind) {
  try { renameSync(join(dir, kind + '-' + call), join(dir, (kind === 'hold' ? 'holding-' : 'failed-') + call)); return true; } catch { return false; }
}
if (gate('hold')) while (existsSync(join(dir, 'holding-' + call))) Bun.sleepSync(5);
if (gate('fail')) { console.error('Error response from daemon: i/o timeout'); process.exit(1); }
const lock = join(dir, 'state.lock');
for (;;) {
  try { mkdirSync(lock); break; } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    Bun.sleepSync(2);
  }
}
process.on('exit', () => rmdirSync(lock));
const path = join(dir, 'state.json');
const s = JSON.parse(readFileSync(path, 'utf8'));
function done(output = '') {
  writeFileSync(path, JSON.stringify(s));
  if (output !== '') console.log(output);
  process.exit(0);
}
function fail(message) { console.error(message); process.exit(1); }
const values = (flag) => a.filter((_, i) => a[i - 1] === flag);
const name = a.at(-1);
const filters = values('--filter').map((filter) => filter.replace(/^label=/, '').split('='));
if (command === 'volume' && sub === 'ls') {
  done(Object.entries(s.volumes)
    .filter(([, volume]) => filters.every(([key, value]) => (volume.labels ?? {})[key] === value))
    .map(([volume]) => volume).join('\n'));
}
if (command === 'volume' && sub === 'create') {
  if (!(name in s.volumes)) s.volumes[name] = { labels: { 'tale.sandbox-cache': '1' }, users: [] };
  done(name);
}
if (command === 'volume' && (sub === 'inspect' || sub === 'rm')) {
  const volume = s.volumes[name];
  if (volume === undefined) fail('Error response from daemon: get ' + name + ': no such volume');
  if (sub === 'inspect') done(JSON.stringify(volume.labels));
  if (volume.users.length > 0) {
    fail('Error response from daemon: remove ' + name + ': volume is in use - [' + volume.users.join(', ') + ']');
  }
  delete s.volumes[name];
  done(name);
}
// The one-shot chmod that makes a new cache writable.
if (command === 'run') done();
if (command === 'ps') {
  done(s.containers
    .filter((container) => filters.every(([key, value]) =>
      key === 'tale.sandbox-session' || (key === 'tale.org' && container.org === value)))
    .map((container) => container.org).join('\n'));
}
fail('Unhandled fake docker call: ' + JSON.stringify(a));
`;

const DAY = 24 * 60 * 60 * 1000;
// Now: a use a create records is stamped with the real clock.
const T0 = Date.now();

let fake = '';
let root = '';
const originalDockerBin = process.env.DOCKER_BIN;

beforeAll(async () => {
  fake = await mkdtemp(join(tmpdir(), 'tale-package-cache-'));
  await writeFile(join(fake, 'docker'), FAKE_DOCKER);
  await chmod(join(fake, 'docker'), 0o755);
  process.env.DOCKER_BIN = join(fake, 'docker');
});
beforeEach(async () => {
  for (const entry of await readdir(fake)) {
    if (entry !== 'docker') await rm(join(fake, entry), { recursive: true });
  }
  await writeFile(
    join(fake, 'state.json'),
    JSON.stringify({ volumes: {}, containers: [] }),
  );
  root = join(fake, 'sessions');
});
afterAll(async () => {
  if (originalDockerBin === undefined) delete process.env.DOCKER_BIN;
  else process.env.DOCKER_BIN = originalDockerBin;
  await rm(fake, { recursive: true, force: true });
});

const cfg = (packageCacheRetentionMs?: number) => ({
  hostSessionRoot: root,
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  ...(packageCacheRetentionMs !== undefined ? { packageCacheRetentionMs } : {}),
});

/** The image a cache volume's permission setup runs: the runtime image the
 * sessions use, as it is on the host. */
const RUNTIME_IMAGE = 'tale-sandbox-runtime:test';

let sequence = 0;
const nextOrg = () => `org_pkg_${++sequence}`;
const caches = (org: string) => ['pip', 'npm', 'bun'].map((p) => `${p}-${org}`);

interface State {
  volumes: Record<string, { labels: Record<string, string>; users: string[] }>;
  containers: Array<{ org: string }>;
}

async function state(): Promise<State> {
  return JSON.parse(await readFile(join(fake, 'state.json'), 'utf8'));
}

async function setState(update: (s: State) => void): Promise<void> {
  const s = await state();
  update(s);
  await writeFile(join(fake, 'state.json'), JSON.stringify(s));
}

/** The organization's three labelled cache volumes, mounted by `users`. */
async function plantCaches(org: string, users: string[] = []): Promise<void> {
  await setState((s) => {
    for (const name of caches(org)) {
      s.volumes[name] = { labels: { 'tale.sandbox-cache': '1' }, users };
    }
  });
}

const markerPath = (org: string) =>
  join(root, '.package-caches', `${org}.used`);

async function marker(org: string): Promise<number | null> {
  try {
    return Number((await readFile(markerPath(org), 'utf8')).trim());
  } catch {
    return null;
  }
}

async function plantMarker(org: string, atMs: number): Promise<void> {
  await mkdir(join(root, '.package-caches'), { recursive: true });
  await writeFile(markerPath(org), `${atMs}\n`);
}

async function left(org: string): Promise<string[]> {
  const { volumes } = await state();
  return caches(org).filter((name) => name in volumes);
}

async function calls(): Promise<string[][]> {
  const text = await readFile(join(fake, 'calls.jsonl'), 'utf8').catch(
    () => '',
  );
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function held(call: string): Promise<void> {
  for (;;) {
    try {
      await stat(join(fake, `holding-${call}`));
      return;
    } catch {
      await Bun.sleep(5);
    }
  }
}

/** Run `body` with console.log and console.warn captured. */
async function quietly<T>(
  body: () => Promise<T>,
): Promise<{ result: T; logged: string[]; warned: string[] }> {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = await body();
    return {
      result,
      logged: log.mock.calls.map((args) => args.map(String).join(' ')),
      warned: warn.mock.calls.map((args) => args.map(String).join(' ')),
    };
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
}

describe('expirePackageCaches', () => {
  test('removes an organization’s three volumes and its marker once unused for the retention, and only then', async () => {
    const stale = nextOrg();
    const fresh = nextOrg();
    await plantCaches(stale);
    await plantCaches(fresh);
    await plantMarker(stale, T0 - 15 * DAY);
    await plantMarker(fresh, T0 - 13 * DAY);
    const { result, logged } = await quietly(() =>
      expirePackageCaches(cfg(), T0),
    );
    expect(DEFAULT_PACKAGE_CACHE_RETENTION_MS).toBe(14 * DAY);
    expect(result).toBe(3);
    expect(await left(stale)).toEqual([]);
    expect(await marker(stale)).toBeNull();
    expect(await left(fresh)).toEqual(caches(fresh));
    expect(await marker(fresh)).toBe(T0 - 13 * DAY);
    expect(logged.join('\n')).toContain(`removed ${stale}'s package caches`);
  });

  test('an organization with caches but no marker gets one at first sight, so the full retention counts from then', async () => {
    const org = nextOrg();
    await plantCaches(org);
    const first = await quietly(() => expirePackageCaches(cfg(), T0));
    expect(first.result).toBe(0);
    expect(await marker(org)).toBe(T0);
    expect(first.logged.join('\n')).toContain('had no recorded use');
    // One day short of the retention since first sight: kept.
    await quietly(() => expirePackageCaches(cfg(), T0 + 13 * DAY));
    expect(await left(org)).toEqual(caches(org));
    await quietly(() => expirePackageCaches(cfg(), T0 + 14 * DAY));
    expect(await left(org)).toEqual([]);
  });

  test('a session container of the organization, in any state, keeps the caches and counts as a use', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await plantMarker(org, T0 - 30 * DAY);
    await setState((s) => {
      s.containers.push({ org });
    });
    expect((await quietly(() => expirePackageCaches(cfg(), T0))).result).toBe(
      0,
    );
    expect(await left(org)).toEqual(caches(org));
    expect(await marker(org)).toBe(T0);
    // The retention counts from the last sweep that saw it in use.
    await setState((s) => {
      s.containers = [];
    });
    await quietly(() => expirePackageCaches(cfg(), T0 + 13 * DAY));
    expect(await left(org)).toEqual(caches(org));
  });

  test('a volume Docker refuses to remove (a container mounts it) stays, with its marker, for the next sweep', async () => {
    const org = nextOrg();
    await plantCaches(org, ['tale-sbx-ses-unlisted']);
    await plantMarker(org, T0 - 30 * DAY);
    const { result, warned } = await quietly(() =>
      expirePackageCaches(cfg(), T0),
    );
    expect(result).toBe(0);
    expect(await left(org)).toEqual(caches(org));
    expect(await marker(org)).toBe(T0 - 30 * DAY);
    expect(warned.join('\n')).toContain('volume is in use');
  });

  test('a retention of 0 keeps every cache and asks the daemon nothing', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await plantMarker(org, T0 - 300 * DAY);
    expect(await expirePackageCaches(cfg(0), T0)).toBe(0);
    expect(await left(org)).toEqual(caches(org));
    expect(await calls()).toEqual([]);
  });

  test('a session list that cannot be read removes nothing', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await plantMarker(org, T0 - 30 * DAY);
    await writeFile(join(fake, 'fail-ps'), '');
    await rejects(
      expirePackageCaches(cfg(), T0),
      /cannot list session containers/,
    );
    expect(await left(org)).toEqual(caches(org));
  });

  test('the retention is the configured one', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await plantMarker(org, T0 - 3 * DAY);
    await quietly(() => expirePackageCaches(cfg(4 * DAY), T0));
    expect(await left(org)).toEqual(caches(org));
    await quietly(() => expirePackageCaches(cfg(2 * DAY), T0));
    expect(await left(org)).toEqual([]);
  });

  test('a marker whose organization has no caches left goes once older than the retention', async () => {
    const gone = nextOrg();
    const recent = nextOrg();
    await plantMarker(gone, T0 - 15 * DAY);
    await plantMarker(recent, T0 - DAY);
    await quietly(() => expirePackageCaches(cfg(), T0));
    expect(await marker(gone)).toBeNull();
    expect(await marker(recent)).toBe(T0 - DAY);
  });

  test('the removal forgets the ensure memo: the next create makes the volumes again', async () => {
    const org = nextOrg();
    const [pip] = caches(org);
    await plantCaches(org);
    await ensureCacheVolume(pip!, RUNTIME_IMAGE);
    await plantMarker(org, T0 - 15 * DAY);
    await quietly(() => expirePackageCaches(cfg(), T0));
    expect(await left(org)).toEqual([]);
    await ensureCacheVolume(pip!, RUNTIME_IMAGE);
    expect((await state()).volumes[pip!]).toBeDefined();
  });
});

describe('holdPackageCaches', () => {
  test('a create’s use is recorded, and while held keeps the caches even past the retention', async () => {
    const org = nextOrg();
    await plantCaches(org);
    const use = holdPackageCaches({ hostSessionRoot: root }, org);
    await use.ready;
    const recorded = await marker(org);
    expect(recorded).toBeGreaterThanOrEqual(T0);
    // Even a recorded use long gone (its write failed) leaves held caches.
    await plantMarker(org, T0 - 30 * DAY);
    await quietly(() => expirePackageCaches(cfg(), T0));
    expect(await left(org)).toEqual(caches(org));
    use.release();
    use.release();
    await quietly(() => expirePackageCaches(cfg(), T0));
    expect(await left(org)).toEqual([]);
  });

  test('a create that comes during a removal waits for it, then records its use', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await plantMarker(org, T0 - 30 * DAY);
    await writeFile(join(fake, 'hold-rm'), '');
    const sweep = quietly(() => expirePackageCaches(cfg(), T0));
    await held('rm');
    const use = holdPackageCaches({ hostSessionRoot: root }, org);
    let ready = false;
    void use.ready.then(() => {
      ready = true;
      return undefined;
    });
    await Bun.sleep(50);
    expect(ready).toBe(false);
    await rm(join(fake, 'holding-rm'));
    expect((await sweep).result).toBe(3);
    await use.ready;
    expect(await left(org)).toEqual([]);
    // Recorded after the removal took the old marker away.
    expect(await marker(org)).toBeGreaterThan(T0 - 30 * DAY);
    use.release();
  });
});

describe('makePackageCacheSweep', () => {
  test('looks at most once per interval, and a failed look is logged, not thrown', async () => {
    const org = nextOrg();
    await plantCaches(org);
    await writeFile(join(fake, 'fail-ls'), '');
    const sweep = makePackageCacheSweep(cfg());
    const failed = await quietly(() => sweep(T0));
    expect(failed.result).toBe(0);
    expect(failed.warned.join('\n')).toContain('package cache sweep failed');
    await sweep(T0 + PACKAGE_CACHE_SWEEP_INTERVAL_MS - 1);
    expect(await calls()).toHaveLength(1);
    await quietly(() => sweep(T0 + PACKAGE_CACHE_SWEEP_INTERVAL_MS));
    expect(await marker(org)).toBe(T0 + PACKAGE_CACHE_SWEEP_INTERVAL_MS);
  });
});
