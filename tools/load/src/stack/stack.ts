/**
 * A local, horizontally scaled Tale backend for load runs on one machine:
 * N `api` processes and M `worker` processes of the real platform entry
 * point (`services/platform/backend/main.ts`), plus optionally the mock
 * model provider, started detached and recorded in a state file so `down`
 * can stop exactly what `up` started.
 *
 * It answers the question a single process cannot: does adding API
 * processes add capacity, or does something shared (the database, a lock,
 * a hot row) cap the deployment? Each api process listens on its own port;
 * the generator spreads users across them (`run --target a,b,c`), which is
 * what the proxy's load balancing does in a real deployment.
 *
 * The database, object store and configuration come from an env file (the
 * same variables a deployment sets); the launcher only adds the role, the
 * port and the list of origins Better Auth must trust.
 */

import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeAtomically } from '../runner/report.ts';

export interface StackProcess {
  role: 'api' | 'worker' | 'mock';
  pid: number;
  port: number | null;
  log: string;
}

export interface StackState {
  version: 1;
  startedAt: string;
  platformDir: string;
  apiUrls: string[];
  mockUrl: string | null;
  processes: StackProcess[];
}

export interface StackUpOptions {
  platformDir: string;
  envFile: string;
  api: number;
  workers: number;
  basePort: number;
  host: string;
  stateFile: string;
  logDir: string;
  /** Start the mock provider too, on this port (null: do not). */
  mockPort: number | null;
  mockProcesses: number;
  /** Extra Node flags for the platform processes, e.g. a heap ceiling. */
  nodeOptions: string;
  /** Overrides on top of the env file, e.g. DATABASE_POOL_MAX=20. */
  extraEnv: Record<string, string>;
  readyTimeoutMs: number;
}

/** Parse a dotenv-style file: KEY=value lines, `#` comments, no expansion. */
export function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match === null) continue;
    let value = match[2] ?? '';
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1] ?? ''] = value;
  }
  return env;
}

function spawnDetached(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string },
): number {
  const out = openSync(options.log, 'a');
  try {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    if (child.pid === undefined) {
      throw new Error(`could not start ${command} ${args.join(' ')}`);
    }
    return child.pid;
  } finally {
    closeSync(out);
  }
}

async function waitReady(url: string, deadline: number): Promise<boolean> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch (error) {
      // Not listening yet: the process is still booting (migrations run at
      // boot under one advisory lock, so later processes wait their turn).
      void error;
    }
    await new Promise((wake) => setTimeout(wake, 500));
  }
  return false;
}

export async function stackUp(options: StackUpOptions): Promise<StackState> {
  const platformDir = resolve(options.platformDir);
  const main = join(platformDir, 'backend', 'main.ts');
  if (!existsSync(main)) {
    throw new Error(`${main} not found: --platform must be services/platform`);
  }
  if (existsSync(options.stateFile)) {
    throw new Error(
      `${options.stateFile} exists: run 'stack down' first, or pass another --state`,
    );
  }
  await mkdir(options.logDir, { recursive: true });
  const fileEnv = parseEnvFile(readFileSync(options.envFile, 'utf8'));
  const apiUrls = Array.from(
    { length: options.api },
    (_, i) => `http://${options.host}:${options.basePort + i}`,
  );
  const siteUrl = apiUrls[0] ?? `http://${options.host}:${options.basePort}`;
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...fileEnv,
    SITE_URL: fileEnv.SITE_URL ?? siteUrl,
    ADDITIONAL_SITE_URLS: [
      ...(fileEnv.ADDITIONAL_SITE_URLS ?? '')
        .split(/[\s,]+/)
        .filter((url) => url !== ''),
      ...apiUrls.filter((url) => url !== (fileEnv.SITE_URL ?? siteUrl)),
    ].join(','),
    NODE_OPTIONS: [process.env.NODE_OPTIONS ?? '', options.nodeOptions]
      .join(' ')
      .trim(),
    ...options.extraEnv,
  };
  const nodeArgs = [
    '--experimental-transform-types',
    '--disable-warning=ExperimentalWarning',
    '--import',
    './backend/node-loader.mjs',
    'backend/main.ts',
  ];
  const processes: StackProcess[] = [];

  if (options.mockPort !== null) {
    const cli = fileURLToPath(new URL('../cli.ts', import.meta.url));
    const log = join(options.logDir, 'mock.log');
    const pid = spawnDetached(
      process.execPath,
      [
        cli,
        'mock',
        '--port',
        String(options.mockPort),
        '--processes',
        String(options.mockProcesses),
        '--host',
        options.host,
      ],
      { cwd: platformDir, env: process.env, log },
    );
    processes.push({ role: 'mock', pid, port: options.mockPort, log });
  }

  // The first api process migrates the schema; start it alone and wait, so
  // the others boot against a migrated database instead of queuing on the
  // migration lock for minutes.
  for (let i = 0; i < options.api; i += 1) {
    const port = options.basePort + i;
    const log = join(options.logDir, `api-${i}.log`);
    const pid = spawnDetached(process.execPath, nodeArgs, {
      cwd: platformDir,
      env: { ...baseEnv, ...roleEnv('api'), PORT: String(port) },
      log,
    });
    processes.push({ role: 'api', pid, port, log });
    if (i === 0) {
      const ready = await waitReady(
        `${apiUrls[0]}/api/health/ready`,
        Date.now() + options.readyTimeoutMs,
      );
      if (!ready) {
        await writeState(
          options.stateFile,
          platformDir,
          apiUrls,
          options,
          processes,
        );
        throw new Error(`api-0 did not become ready; see ${log}`);
      }
    }
  }
  for (let i = 0; i < options.workers; i += 1) {
    const log = join(options.logDir, `worker-${i}.log`);
    const pid = spawnDetached(process.execPath, nodeArgs, {
      cwd: platformDir,
      env: { ...baseEnv, ...roleEnv('worker') },
      log,
    });
    processes.push({ role: 'worker', pid, port: null, log });
  }
  const state = await writeState(
    options.stateFile,
    platformDir,
    apiUrls,
    options,
    processes,
  );
  const deadline = Date.now() + options.readyTimeoutMs;
  const ready = await Promise.all(
    apiUrls.map((url) => waitReady(`${url}/api/health/ready`, deadline)),
  );
  const notReady = apiUrls.filter((_, i) => !ready[i]);
  if (notReady.length > 0) {
    throw new Error(`api processes not ready: ${notReady.join(', ')}`);
  }
  // A worker serves no port, so readiness cannot see it die at boot (a bad
  // env, a crash on its first job): check it is still there.
  const dead = processes.filter((p) => p.role === 'worker' && !alive(p.pid));
  if (dead.length > 0) {
    throw new Error(
      `worker processes exited at boot; see ${dead.map((p) => p.log).join(', ')}`,
    );
  }
  return state;
}

/**
 * The role a process plays, as the backend reads it (`ROLE` in
 * backend/env.ts). `TALE_ROLE` is what the container's entrypoint maps to
 * `ROLE`; it rides along so a process looks the same either way.
 */
export function roleEnv(
  role: 'api' | 'worker',
): Record<'ROLE' | 'TALE_ROLE', string> {
  return { ROLE: role, TALE_ROLE: role };
}

async function writeState(
  stateFile: string,
  platformDir: string,
  apiUrls: string[],
  options: StackUpOptions,
  processes: StackProcess[],
): Promise<StackState> {
  const state: StackState = {
    version: 1,
    startedAt: new Date().toISOString(),
    platformDir,
    apiUrls,
    mockUrl:
      options.mockPort === null
        ? null
        : `http://${options.host}:${options.mockPort}`,
    processes,
  };
  await writeAtomically(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

async function readState(stateFile: string): Promise<StackState> {
  return JSON.parse(await readFile(stateFile, 'utf8')) as StackState;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: gone. Anything else (EPERM) means it exists but is not ours.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Stop what `up` started: SIGTERM (the platform drains its streams and
 * jobs), then SIGKILL whatever is still alive after the grace period.
 */
export async function stackDown(
  stateFile: string,
  graceMs = 30_000,
): Promise<{ stopped: number; killed: number }> {
  const state = await readState(stateFile);
  const pids = state.processes.map((p) => p.pid).filter(alive);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      console.warn(`[stack] could not signal ${pid}:`, error);
    }
  }
  const deadline = Date.now() + graceMs;
  while (pids.some(alive) && Date.now() < deadline) {
    await new Promise((wake) => setTimeout(wake, 250));
  }
  let killed = 0;
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(pid, 'SIGKILL');
      killed += 1;
    } catch (error) {
      console.warn(`[stack] could not kill ${pid}:`, error);
    }
  }
  const { rm } = await import('node:fs/promises');
  await rm(stateFile, { force: true });
  return { stopped: pids.length, killed };
}

export async function stackStatus(stateFile: string): Promise<
  {
    role: string;
    pid: number;
    port: number | null;
    alive: boolean;
    ready: boolean | null;
  }[]
> {
  const state = await readState(stateFile);
  return Promise.all(
    state.processes.map(async (p) => {
      let ready: boolean | null = null;
      if (p.role === 'api' && p.port !== null) {
        const base = state.apiUrls.find((url) => url.endsWith(`:${p.port}`));
        ready =
          base === undefined
            ? false
            : await waitReady(`${base}/api/health/ready`, Date.now() + 1);
      }
      return {
        role: p.role,
        pid: p.pid,
        port: p.port,
        alive: alive(p.pid),
        ready,
      };
    }),
  );
}
