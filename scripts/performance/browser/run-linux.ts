import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
  childEnvironment,
  json,
  outputPath,
  phaseTimeout,
  runLogged,
  sources,
} from './common.ts';
import {
  cleanupLinuxResources,
  containerResourceArgs,
  createResourcePlan,
  initializeLinuxResources,
  sampleLinuxResources,
  verifyContainerResources,
} from './linux-resources.ts';
import { browserOrigins } from './origins.mjs';
import { nativeIO } from './resource-io.ts';

const boundedIO = {
  ...nativeIO,
  command: (command: string, args: readonly string[], timeout: number) =>
    nativeIO.command(command, args, phaseTimeout(timeout)),
};

const browserImage =
  'mcr.microsoft.com/playwright@sha256:1e83c10ccee0065f527953861d176a828a31a84324688ecb03f11912296c8444';
const source = await sources();
await readFile(outputPath('builds.json'));
const token = randomBytes(16).toString('hex');
await nativeIO.writeExclusive(outputPath('resource-token'), token);
const plan = createResourcePlan(process.env.BENCH_OUTPUT!, token);
const secret = randomBytes(32).toString('hex');
const monitoring = { active: true };
let monitor: Promise<void> | undefined;
let monitorError: unknown;
const samples: unknown[] = [];
const env = childEnvironment({
  DB_PASSWORD: secret,
  BENCH_PASSWORD: `Synthetic-${randomBytes(32).toString('hex')}!`,
});
try {
  // Fetching/setup precedes the constrained and offline measured phase.
  await runLogged('docker', ['pull', browserImage], {
    cwd: source.candidatePath,
    log: outputPath('browser-image.log'),
    timeoutMs: 300_000,
  });
  const image = await boundedIO.command(
    'docker',
    ['image', 'inspect', '--format', '{{.Id}}', 'tale-db:browser-performance'],
    15_000,
  );
  assert.equal(image.code, 0, 'Disposable database image is missing');
  const databaseImage = image.stdout.trim();
  assert.match(databaseImage, /^sha256:[a-f0-9]{64}$/);
  await json('images.json', { databaseImage, browserImage });
  await json(
    'docker-host.json',
    await initializeLinuxResources(boundedIO, plan),
  );
  const dbArgs = [
    'run',
    '--detach',
    ...containerResourceArgs(plan, 'db'),
    '--network',
    'none',
    '--shm-size',
    '128m',
    '--pids-limit',
    '256',
    '-e',
    'DB_PASSWORD',
    '-e',
    'DB_SHARED_BUFFERS=128MB',
    '-e',
    'DB_WORK_MEM=4MB',
    databaseImage,
  ];
  await runLogged('docker', dbArgs, {
    cwd: source.candidatePath,
    log: outputPath('database-start.log'),
    timeoutMs: 30_000,
    env,
  });
  const db = await verifyContainerResources(boundedIO, plan, 'db');
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = await boundedIO.command(
      'docker',
      [
        'exec',
        db.id,
        'sh',
        '-c',
        'test -f /tmp/.db_ready && pg_isready -U tale -d tale',
      ],
      2000,
    );
    if (probe.code === 0) {
      healthy = true;
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  assert(healthy, 'Owned database health marker did not become ready');
  // Keep source paths stable in the container so Bun workspace symlinks resolve
  // to their own arm. These are owned ephemeral CI trees, not user workspaces.
  const runtimeEnv = {
    ...env,
    BENCH_OUTPUT: process.env.BENCH_OUTPUT!,
    BENCH_SOURCE: source.candidatePath,
    BENCH_BASELINE: source.baselinePath,
    BENCH_URL: browserOrigins[0]!,
    DATABASE_URL: `postgres://tale:${secret}@127.0.0.1:5432/tale_app`,
    KNOWLEDGE_DATABASE_URL: `postgres://tale:${secret}@127.0.0.1:5432/tale_knowledge`,
    BENCH_CHROMIUM: '/ms-playwright/chromium-1194/chrome-linux/chrome',
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    ENCRYPTION_SECRET_HEX: randomBytes(32).toString('hex'),
    WEBDAV_APP_PASSWORD_HMAC_KEY: randomBytes(32).toString('hex'),
  };
  const bunLocation = await boundedIO.command(
    'bun',
    ['--print', 'process.execPath'],
    10_000,
  );
  assert.equal(bunLocation.code, 0);
  const bunPath = await realpath(bunLocation.stdout.trim());
  assert(
    isAbsolute(bunPath) && !/[\r\n,]/.test(bunPath),
    'Invalid pinned Bun path',
  );
  const bunVersion = await boundedIO.command(bunPath, ['--version'], 10_000);
  assert.equal(bunVersion.code, 0);
  assert.equal(
    bunVersion.stdout.trim(),
    source.bun,
    'Mounted Bun differs from root pin',
  );
  await json('bun-runtime.json', {
    version: source.bun,
    path: bunPath,
    sha256: createHash('sha256')
      .update(await readFile(bunPath))
      .digest('hex'),
  });
  const args = [
    'run',
    '--detach',
    ...containerResourceArgs(plan, 'browser'),
    '--network',
    `container:${db.id}`,
    '--user',
    `${process.getuid!()}:${process.getgid!()}`,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--shm-size',
    '512m',
    '--pids-limit',
    '512',
    '--mount',
    `type=bind,src=${source.candidatePath},dst=${source.candidatePath}`,
    '--mount',
    `type=bind,src=${source.baselinePath},dst=${source.baselinePath}`,
    '--mount',
    `type=bind,src=${process.env.BENCH_OUTPUT},dst=${process.env.BENCH_OUTPUT}`,
    '--mount',
    `type=bind,src=${process.execPath},dst=/tools/node,readonly`,
    '--mount',
    `type=bind,src=${bunPath},dst=/tools/bun,readonly`,
    '--workdir',
    source.candidatePath,
    ...Object.keys(runtimeEnv)
      .filter((key) => !['PATH', 'HOME'].includes(key))
      .flatMap((key) => ['-e', key]),
    '-e',
    'PATH=/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    '-e',
    'HOME=/tmp',
    '--entrypoint',
    '/tools/node',
    browserImage,
    '--experimental-transform-types',
    '--disable-warning=ExperimentalWarning',
    join(source.candidatePath, 'scripts/performance/browser/inside.ts'),
  ];
  await runLogged('docker', args, {
    cwd: source.candidatePath,
    log: outputPath('browser-start.log'),
    timeoutMs: 30_000,
    env: runtimeEnv,
  });
  const browser = await verifyContainerResources(boundedIO, plan, 'browser');
  await json('resource-membership.json', { db, browser, plan });
  // The child waits for this proof; it cannot seed or measure before the host
  // verifies that BOTH container PIDs share the exact constrained slice.
  await writeFile(outputPath('resources-verified'), token, {
    flag: 'wx',
    mode: 0o600,
  });
  monitor = (async () => {
    while (monitoring.active) {
      samples.push({
        at: Date.now(),
        counters: await sampleLinuxResources(boundedIO, plan),
      });
      await json('resources.json', samples);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
  })().catch((error) => {
    monitorError = error;
    monitoring.active = false;
  });
  // Attach after the ownership proof; Docker replays all buffered output.
  await runLogged('docker', ['attach', '--sig-proxy=false', browser.id], {
    cwd: source.candidatePath,
    log: outputPath('browser-run.log'),
    timeoutMs: 900_000,
  });
  const finished = JSON.parse(
    await readFile(outputPath('inside-complete.json'), 'utf8'),
  ) as { ok?: boolean };
  assert.equal(
    finished.ok,
    true,
    'Browser phase did not write a complete success receipt',
  );
} catch (error) {
  await json('runner-failure.json', { error: String(error) });
  throw error;
} finally {
  monitoring.active = false;
  try {
    await monitor;
  } catch (error) {
    monitorError = error;
  }
  const logErrors: string[] = [];
  for (const role of ['db', 'browser'] as const) {
    try {
      const cid = await nativeIO.readFile(plan.cidPaths[role]);
      if (cid && /^[a-f0-9]{64}$/.test(cid.trim())) {
        const logs = await nativeIO.command(
          'docker',
          ['logs', cid.trim()],
          5000,
        );
        await writeFile(
          outputPath(`${role}-final.log`),
          logs.stdout + logs.stderr,
        );
      }
    } catch (error) {
      logErrors.push(`${role}: ${String(error)}`);
    }
  }
  const cleanup = await cleanupLinuxResources(nativeIO, plan);
  await json('cleanup.json', cleanup);
  await json('log-collection.json', { errors: logErrors });
  assert(cleanup.ok, 'Owned resource cleanup failed');
  assert(!monitorError, `Resource monitoring failed: ${String(monitorError)}`);
}
