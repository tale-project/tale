// The measured container has only an owned shared loopback namespace. Its host
// coordinator verifies both container cgroups before releasing this process.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, readlink } from 'node:fs/promises';
import { arch, cpus, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  json,
  outputPath,
  phaseTimeout,
  runLogged,
  sources,
} from './common.ts';
import { measurementPlan } from './mode.mjs';
import { backendOrigin, browserOrigins } from './origins.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const baseline = process.env.BENCH_BASELINE!;
const candidate = process.env.BENCH_SOURCE!;
const children: ChildProcess[] = [];
const mode = (await sources()).mode;
const measurement = measurementPlan(mode);
const environment = {
  ...process.env,
  ROLE: 'api',
  PORT: '43838',
  SITE_URL: process.env.BENCH_URL,
  ADDITIONAL_SITE_URLS: browserOrigins[1],
  TALE_CONFIG_DIR: outputPath('config'),
  TALE_CONFIG_BUILTIN_DIR: outputPath('builtin'),
  TALE_CONFIG_SYSTEM_DIR: outputPath('system'),
  TALE_ALLOW_OPEN_SIGN_UP: 'true',
  TALE_PROVISIONING_DISABLED: '1',
};

function start(
  args: string[],
  cwd: string,
  name: string,
  extra: Record<string, string> = {},
  executable = process.execPath,
) {
  const log = openSync(outputPath(`${name}.log`), 'wx', 0o600);
  const child = spawn(executable, args, {
    cwd,
    env: { ...environment, ...extra },
    stdio: ['ignore', log, log],
  });
  children.push(child);
  child.once('close', () => closeSync(log));
  child.once('error', (error) => {
    void json(`${name}-failure.json`, { error: String(error) });
  });
  return child;
}

async function listenerOwned(pid: number, port: number) {
  const tables = await Promise.all(
    ['tcp', 'tcp6'].map((name) => readFile(`/proc/${pid}/net/${name}`, 'utf8')),
  );
  const inodes = tables
    .flatMap((table) => table.trim().split('\n').slice(1))
    .map((line) => line.trim().split(/\s+/))
    .filter(
      (fields) =>
        fields[3] === '0A' &&
        Number.parseInt(fields[1]!.split(':')[1]!, 16) === port,
    )
    .map((fields) => fields[9]);
  if (!inodes.length) return false;
  const descriptors = await readdir(`/proc/${pid}/fd`);
  for (const fd of descriptors) {
    let target: string;
    try {
      target = await readlink(`/proc/${pid}/fd/${fd}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (inodes.some((inode) => target === `socket:[${inode}]`)) return true;
  }
  assert.fail(`Diagnostic port ${port} belongs to another process`);
}

async function ready(url: string, child: ChildProcess) {
  const port = Number(new URL(url).port);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    phaseTimeout(1000);
    assert(
      child.pid && child.exitCode === null,
      'Owned service stopped before readiness',
    );
    if (await listenerOwned(child.pid, port)) {
      try {
        const answer = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (answer.ok) {
          assert(
            await listenerOwned(child.pid, port),
            'Listener ownership changed',
          );
          assert.equal(child.exitCode, null);
          return;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error('Owned service readiness timed out');
}

async function cleanup() {
  for (const child of children.toReversed())
    if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  for (const child of children.toReversed())
    if (child.exitCode === null) child.kill('SIGKILL');
}
process.once('SIGTERM', () => {
  void cleanup().then(() => process.exit(143));
});
process.once('SIGINT', () => {
  void cleanup().then(() => process.exit(130));
});

try {
  let released = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    phaseTimeout(1000);
    try {
      const token = await readFile(outputPath('resources-verified'), 'utf8');
      assert.match(token, /^[a-f0-9]{32}$/);
      assert.equal(
        token,
        await readFile(outputPath('resource-token'), 'utf8'),
        'Resource proof belongs to another run',
      );
      released = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  assert(released, 'Host resource proof did not arrive');
  assert.equal(
    process.versions.node,
    (await sources()).node,
    'Measured Node differs from source pin',
  );
  await json('runtime.json', {
    node: process.version,
    nodeExecutableSha256: createHash('sha256')
      .update(await readFile(process.execPath))
      .digest('hex'),
    platform: platform(),
    arch: arch(),
    kernel: release(),
    hostCpuModels: [...new Set(cpus().map((cpu) => cpu.model))],
    hostCpuCount: cpus().length,
    hostTotalMemory: totalmem(),
    limitScope:
      'Host CPU count and RAM are descriptive; enforced shared quotas are in resource-membership.json and resources.json.',
  });
  await cp(join(baseline, 'configs/platform/custom'), outputPath('builtin'), {
    recursive: true,
    errorOnExist: true,
  });
  await cp(join(baseline, 'configs/platform/system'), outputPath('system'), {
    recursive: true,
    errorOnExist: true,
  });
  await mkdir(outputPath('config'));
  const backend = start(
    [
      '--max-old-space-size=1536',
      '--import',
      join(scripts, 'loopback-only.mjs'),
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './backend/node-loader.mjs',
      'backend/main.ts',
    ],
    join(baseline, 'services/platform'),
    'backend',
  );
  await ready('http://127.0.0.1:43838/ready', backend);
  const listeners = [{ name: 'backend', pid: backend.pid, port: 43838 }];
  for (const [index, name] of ['baseline', 'candidate'].entries()) {
    const origin = browserOrigins[index]!;
    const web = start(
      [join(scripts, 'serve-web.ts'), name],
      join(name === 'baseline' ? baseline : candidate, 'services/platform'),
      `web-${name}`,
      {
        SITE_URL: origin,
        ADDITIONAL_SITE_URLS: browserOrigins
          .filter((entry) => entry !== origin)
          .join(','),
        TALE_BACKEND_URL: backendOrigin,
      },
      '/tools/bun',
    );
    await ready(`${origin}/api/health`, web);
    listeners.push({ name, pid: web.pid, port: Number(new URL(origin).port) });
  }
  await json('listeners.json', listeners);
  await runLogged(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      join(scripts, 'tls-proof.ts'),
    ],
    {
      cwd: candidate,
      env: environment,
      log: outputPath('tls-proof.log'),
      timeoutMs: 120_000,
    },
  );
  await runLogged(
    process.execPath,
    [join(scripts, 'seed-http.mjs'), 'diagnostic'],
    {
      cwd: candidate,
      env: environment,
      log: outputPath('seed-http.log'),
      timeoutMs: 120_000,
    },
  );
  if (measurement.seedTasks)
    await runLogged(
      process.execPath,
      [
        '--import',
        join(scripts, 'loopback-only.mjs'),
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        '--import',
        './backend/node-loader.mjs',
        join(scripts, 'seed-tasks.ts'),
      ],
      {
        cwd: join(baseline, 'services/platform'),
        env: environment,
        log: outputPath('seed-tasks.log'),
        timeoutMs: 240_000,
      },
    );
  // Preparation is not a sample. Wait at most 3 minutes for the declared host
  // threshold, then refuse without retrying a measurement under another rule.
  for (let attempt = 0; attempt < 90 && loadavg()[0] >= 2.5; attempt += 1) {
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, phaseTimeout(2000)),
    );
  }
  assert(loadavg()[0] < 2.5, 'Host never reached the fixed idle precondition');
  await runLogged(
    process.execPath,
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      join(scripts, measurement.script),
    ],
    {
      cwd: candidate,
      env: { ...environment, DEBUG: 'pw:browser' },
      log: outputPath('capture.log'),
      timeoutMs: measurement.timeoutMs,
    },
  );
  await json('inside-complete.json', {
    ok: true,
    at: new Date().toISOString(),
  });
} catch (error) {
  await json('inside-failure.json', { error: String(error) });
  throw error;
} finally {
  await cleanup();
}
