import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  snapshotTraffic,
  type TrafficEndpoint,
} from './github-traffic-snapshot';

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), 'tale-traffic-'));
  temporary.push(path);
  return path;
}
function response(endpoint: TrafficEndpoint) {
  return endpoint === 'views' || endpoint === 'clones'
    ? {
        count: 12,
        uniques: 4,
        [endpoint]: [
          { timestamp: '2026-10-02T00:00:00Z', count: 12, uniques: 4 },
        ],
      }
    : [];
}

function runSyntheticSnapshot(output: string, environment: NodeJS.ProcessEnv) {
  const entry = new URL('./github-traffic-snapshot.ts', import.meta.url).href;
  return Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { snapshotTraffic } from ${JSON.stringify(entry)};
       await snapshotTraffic(${JSON.stringify(output)}, (endpoint) => {
         console.log('traffic read');
         return endpoint === 'views' || endpoint === 'clones'
           ? { count: 0, uniques: 0, [endpoint]: [] }
           : [];
       });`,
    ],
    {
      env: { ...process.env, ...environment },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

test('saves validated private snapshots without overwriting a previous observation', async () => {
  const output = await temporaryDirectory();
  const now = new Date('2026-10-03T09:00:00Z');
  const path = await snapshotTraffic(output, response, now);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  expect(saved.repository).toBe('tale-project/tale');
  expect(saved.traffic.views.count).toBe(12);
  expect(saved.window).toContain('must not be summed');
  if (process.platform !== 'win32')
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  const failure = await snapshotTraffic(output, response, now).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(saved);
});

test('an invalid response never produces a partial snapshot', async () => {
  const output = await temporaryDirectory();
  const failure = await snapshotTraffic(output, (endpoint) =>
    endpoint === 'clones' ? { count: -1 } : response(endpoint),
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(await readdir(output)).toEqual([]);
});

test('rejects destinations inside a checkout, including symlinks', async () => {
  const output = await temporaryDirectory();
  execFileSync('git', ['init', '--quiet', output]);
  const failure = await snapshotTraffic(output, response).catch(
    (error: unknown) => error,
  );
  expect(failure).toHaveProperty(
    'message',
    expect.stringContaining('outside Git'),
  );
  if (process.platform !== 'win32') {
    const outside = await temporaryDirectory();
    const link = join(outside, 'linked');
    await symlink(output, link);
    const linkedFailure = await snapshotTraffic(link, response).catch(
      (error: unknown) => error,
    );
    expect(linkedFailure).toHaveProperty(
      'message',
      expect.stringContaining('outside Git'),
    );
  }
});

test('refuses a new destination inside a checkout before creating it', async () => {
  const checkout = await temporaryDirectory();
  execFileSync('git', ['init', '--quiet', checkout]);
  const failure = await snapshotTraffic(
    join(checkout, 'private', 'snapshots'),
    response,
  ).catch((error: unknown) => error);
  expect(failure).toHaveProperty(
    'message',
    expect.stringContaining('outside Git'),
  );
  if (process.platform !== 'win32') {
    const link = join(await temporaryDirectory(), 'linked');
    await symlink(checkout, link);
    const linkedFailure = await snapshotTraffic(
      join(link, 'snapshots'),
      response,
    ).catch((error: unknown) => error);
    expect(linkedFailure).toHaveProperty(
      'message',
      expect.stringContaining('outside Git'),
    );
  }
  const unverified = await temporaryDirectory();
  const child = runSyntheticSnapshot(join(unverified, 'snapshots'), {
    PATH: join(unverified, 'missing-programs'),
  });
  expect(child.stderr.toString()).toContain(
    'Cannot verify the private output directory',
  );
  expect(await readdir(checkout)).toEqual(['.git']);
  expect(await readdir(unverified)).toEqual([]);
});

test('refuses to collect or save traffic when Git is unavailable', async () => {
  const output = await temporaryDirectory();
  execFileSync('git', ['init', '--quiet', output]);
  const child = runSyntheticSnapshot(output, {
    PATH: join(output, 'missing-programs'),
  });

  expect(child.exitCode).toBe(1);
  expect(child.stdout.toString()).toBe('');
  expect(child.stderr.toString()).toContain(
    'Cannot verify the private output directory',
  );
  expect(await readdir(output)).toEqual(['.git']);
});

test('refuses an unexpected Git error even when its exit code is 128', async () => {
  const output = await temporaryDirectory();
  const child = runSyntheticSnapshot(output, {
    GIT_DIR: join(output, 'missing-repository'),
  });

  expect(child.exitCode).toBe(1);
  expect(child.stdout.toString()).toBe('');
  expect(child.stderr.toString()).toContain(
    'Cannot verify the private output directory',
  );
  expect(await readdir(output)).toEqual([]);
});

test('does not let an inherited discovery ceiling hide a parent checkout', async () => {
  const checkout = await temporaryDirectory();
  execFileSync('git', ['init', '--quiet', checkout]);
  const output = join(checkout, 'snapshots');
  await mkdir(output);
  const child = runSyntheticSnapshot(output, {
    GIT_CEILING_DIRECTORIES: checkout,
  });

  expect(child.exitCode).toBe(1);
  expect(child.stdout.toString()).toBe('');
  expect(child.stderr.toString()).toContain('outside Git');
  expect(await readdir(output)).toEqual([]);
});
