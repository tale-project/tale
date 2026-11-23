/**
 * The blue/green flip a budget run provokes after its workload, while the
 * sampler keeps reading: a shell command (`--flip-command`), typically the
 * workspace's `tale deploy`, which starts the app tier's other colour, waits
 * for it, drains the old one and stops it (tools/cli/src/lib/actions/
 * deploy.ts: every deploy without `--services` is a blue/green one). The
 * overlap of the two colours is what the budget bounds to one app-tier
 * share; a run that never provokes one cannot say whether the bound holds.
 *
 * Its output goes to the console line by line, and its last lines are kept
 * for the report. A command still running at its deadline is stopped
 * (SIGTERM, then SIGKILL ten seconds later).
 */

import { spawn } from 'node:child_process';

import type { FlipFigures } from './report.ts';

/** Lines of the command's output the report keeps. */
const TAIL_LINES = 20;

export interface FlipOptions {
  command: string;
  deadlineMs: number;
  /** The sampler's clock. */
  clock: () => number;
  /** Each line of the command's output. */
  log?: (line: string) => void;
  /** The shell the command runs in. */
  shell?: string;
}

/** Run the flip command to its end, or its deadline. */
export function runFlip(options: FlipOptions): Promise<FlipFigures> {
  const log = options.log ?? ((line: string) => console.log(`[flip] ${line}`));
  const startedAtMs = options.clock();
  const tail: string[] = [];
  const keep = (line: string): void => {
    log(line);
    tail.push(line);
    if (tail.length > TAIL_LINES) tail.shift();
  };
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    // A group of its own: the deadline stops the command and everything it
    // started (a deploy's docker calls), which would hold its output open.
    const child = spawn(options.shell ?? '/bin/sh', ['-c', options.command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const signalGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        // ESRCH: the group is gone already.
        if (Reflect.get(Object(error), 'code') !== 'ESRCH') {
          console.warn(
            `[flip] cannot send ${signal} to the flip: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    };
    const pending = { stdout: '', stderr: '' };
    const read =
      (stream: keyof typeof pending) =>
      (chunk: Buffer): void => {
        const lines = `${pending[stream]}${chunk.toString('utf8')}`.split('\n');
        pending[stream] = lines.pop() ?? '';
        for (const line of lines) keep(line.trimEnd());
      };
    child.stdout.on('data', read('stdout'));
    child.stderr.on('data', read('stderr'));
    let killer: ReturnType<typeof setTimeout> | null = null;
    let drain: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      keep(`the flip ran past its deadline of ${options.deadlineMs} ms`);
      signalGroup('SIGTERM');
      killer = setTimeout(() => signalGroup('SIGKILL'), 10_000);
    }, options.deadlineMs);
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killer !== null) clearTimeout(killer);
      if (drain !== null) clearTimeout(drain);
      for (const rest of [pending.stdout, pending.stderr]) {
        if (rest !== '') keep(rest.trimEnd());
      }
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        command: options.command,
        startedAtMs,
        endedAtMs: options.clock(),
        exitCode,
        signal,
        timedOut,
        tail,
      });
    };
    child.once('error', (error) => {
      keep(`the flip could not start: ${error.message}`);
      finish(null, null);
    });
    // Its output ends when the last process holding it does; a process the
    // command left behind may hold it on, so its exit is waited on for five
    // seconds more at most.
    child.once('exit', (code, signal) => {
      drain = setTimeout(() => finish(code, signal), 5_000);
    });
    child.once('close', (code, signal) => finish(code, signal));
  });
}
