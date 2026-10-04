import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const sourceSchema = z.object({
  status: z.literal('ready'),
  mode: z.enum(['diagnostic', 'protocol', 'acceptance']),
  baseline: z.string().regex(/^[a-f0-9]{40}$/),
  candidate: z.string().regex(/^[a-f0-9]{40}$/),
  baselineTree: z.string().regex(/^[a-f0-9]{40}$/),
  candidateTree: z.string().regex(/^[a-f0-9]{40}$/),
  baselinePath: z.string(),
  candidatePath: z.string(),
  node: z.string().regex(/^\d+\.\d+\.\d+$/),
  bun: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export async function sources() {
  assert(process.env.BENCH_OUTPUT, 'BENCH_OUTPUT is required');
  return sourceSchema.parse(
    JSON.parse(
      await readFile(`${process.env.BENCH_OUTPUT}/sources.json`, 'utf8'),
    ),
  );
}

export function outputPath(file: string) {
  assert(process.env.BENCH_OUTPUT, 'BENCH_OUTPUT is required');
  const root = resolve(process.env.BENCH_OUTPUT);
  const path = resolve(root, file);
  assert(
    path.startsWith(`${root}/`),
    'Artifact path escaped its owned directory',
  );
  return path;
}

export async function json(file: string, value: unknown) {
  await writeFile(outputPath(file), JSON.stringify(value, null, 2));
}

/** Leave the job's final minutes for cleanup and artifact retention. */
export function phaseTimeout(
  requested: number,
  deadline = process.env.BENCH_DEADLINE_MS,
  now = Date.now(),
) {
  assert(
    Number.isFinite(requested) && requested > 0,
    'A positive phase budget is required',
  );
  if (deadline === undefined) return requested;
  assert(
    /^\d+$/.test(deadline) && Number.isSafeInteger(Number(deadline)),
    'Malformed diagnostic deadline',
  );
  const remaining = Number(deadline) - now;
  assert(
    remaining > 0,
    'Shared diagnostic deadline expired; preserve cleanup and artifact time',
  );
  return Math.min(requested, remaining);
}

/** Curated child env: never inherit provider credentials or the Actions token. */
export function childEnvironment(extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    DO_NOT_TRACK: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    STORYBOOK_DISABLE_TELEMETRY: '1',
    SCARF_ANALYTICS: 'false',
    ...(process.env.BENCH_DEADLINE_MS
      ? { BENCH_DEADLINE_MS: process.env.BENCH_DEADLINE_MS }
      : {}),
    ...extra,
  };
}

/** Capture the owned group once; buffered output must not signal it repeatedly. */
export function processGroupSignaler(pid: number | undefined) {
  assert(
    pid === undefined || (Number.isSafeInteger(pid) && pid > 1),
    'Refuse an invalid spawned process identity',
  );
  const attempted = new Set<NodeJS.Signals>();
  return (value: NodeJS.Signals) => {
    if (pid === undefined || attempted.has(value)) return;
    attempted.add(value);
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
}

/** Bounded subprocess; cancellation reaches descendants even with closed pipes. */
export async function runLogged(
  command: string,
  args: string[],
  options: {
    cwd: string;
    log: string;
    timeoutMs: number;
    env?: NodeJS.ProcessEnv;
  },
) {
  const timeout = phaseTimeout(options.timeoutMs);
  const log = await open(options.log, 'wx', 0o600);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? childEnvironment(),
    stdio: ['ignore', log.fd, log.fd],
    detached: process.platform !== 'win32',
  });
  const signal = processGroupSignaler(child.pid);
  let rejectCompletion: (error: unknown) => void = () => {};
  const completion = new Promise<number | null>((resolvePromise, reject) => {
    rejectCompletion = reject;
    child.once('error', reject);
    child.once('close', resolvePromise);
  });
  let timedOut = false;
  let interrupted = false;
  let force: ReturnType<typeof setTimeout> | undefined;
  const signalFromCallback = (value: NodeJS.Signals) => {
    try {
      signal(value);
    } catch (error) {
      // An event callback must settle the owner, never throw out of the stream.
      rejectCompletion(error);
    }
  };
  const interrupt = () => {
    interrupted = true;
    signalFromCallback('SIGTERM');
    force ??= setTimeout(() => signalFromCallback('SIGKILL'), 1000);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const timer = setTimeout(() => {
    timedOut = true;
    interrupt();
  }, timeout);
  try {
    const code = await completion;
    assert(!timedOut, 'Diagnostic phase exceeded its time budget');
    assert(!interrupted, 'Diagnostic phase was interrupted');
    assert.equal(code, 0, `Diagnostic phase failed; inspect ${options.log}`);
  } finally {
    clearTimeout(timer);
    if (force) clearTimeout(force);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    try {
      signal('SIGKILL');
    } finally {
      await log.close();
    }
  }
}

/** A short control-plane command with a bounded output buffer and owned process group. */
export async function runCaptured(
  command: string,
  args: readonly string[],
  timeoutMs: number,
) {
  assert(
    Number.isFinite(timeoutMs) && timeoutMs > 0,
    'A positive command deadline is required',
  );
  const child = spawn(command, [...args], {
    detached: process.platform !== 'win32',
    env: childEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const signal = processGroupSignaler(child.pid);
  let stdout = '';
  let stderr = '';
  let failure = false;
  let bytes = 0;
  let rejectCompletion: (error: unknown) => void = () => {};
  const completion = new Promise<number | null>((resolvePromise, reject) => {
    rejectCompletion = reject;
    child.once('error', (error) => {
      failure = true;
      stderr += String(error);
    });
    child.once('close', resolvePromise);
  });
  const stop = () => signal('SIGKILL');
  const stopFromCallback = () => {
    try {
      stop();
    } catch (error) {
      rejectCompletion(error);
    }
  };
  const collect = (chunk: Buffer, destination: 'stdout' | 'stderr') => {
    bytes += chunk.byteLength;
    if (bytes > 1_048_576) {
      failure = true;
      stopFromCallback();
      return;
    }
    if (destination === 'stdout') stdout += chunk.toString('utf8');
    else stderr += chunk.toString('utf8');
  };
  child.stdout.on('data', (chunk) => collect(chunk, 'stdout'));
  child.stderr.on('data', (chunk) => collect(chunk, 'stderr'));
  const timer = setTimeout(() => {
    failure = true;
    stopFromCallback();
  }, timeoutMs);
  const interrupt = () => {
    failure = true;
    stopFromCallback();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const code = await completion;
    return { code: failure ? null : code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
    stop();
  }
}
