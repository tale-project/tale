import type { IncusConfigMap } from '@tale/incus/api';

import { preconditionError } from '../../../../utils/fail';
import type { LogOptions } from '../../types';
import type { IncusVerbContext } from './exec';

/**
 * An instance's log on Incus: its console, `GET /1.0/instances/<n>/console`
 * (design 11, R3-07, R3-32). Incus 7.6 serves no console log file, and what
 * the console endpoint gives depends on the instance's state, as spike S21
 * measured (`spikes/s21/results.md`):
 * - While the instance runs, a read TAKES what it returns: later reads, the
 *   host's `console.log` and the console the instance leaves when it stops
 *   no longer hold those lines, and about 128 KiB is all Incus keeps of the
 *   lines no read took.
 * - Once it stopped, a read returns what Incus kept, and takes nothing.
 *
 * So a running instance's console is read only when the caller asks for it
 * (`--consume`, which `tale logs` prints a one-line warning for), a stopped
 * one is read freely, `--since` is refused (the console holds no times),
 * `--tail` is cut here, and `--follow` polls. Health checks, `status`,
 * `doctor` and deploy waits never read a running console; the crash report
 * reads the stopped one and calls it what it is: the last console lines
 * Incus kept, never the whole run.
 */

/** How often `--follow` reads the console again. */
const FOLLOW_POLL_MS = 1_000;
/** How much of what a follow took it keeps, to find it in a stopped console. */
const TAKEN_TAIL = 4096;
/** State reads, a poll apart, that a failed console read waits for the
 * instance to read stopped before it counts as a failure. */
const ENDED_STATE_READS = 10;
/** The most one console read takes (Incus keeps about 128 KiB). */
const CONSOLE_MAX_BYTES = 4 * 1024 * 1024;
/** The label of a stopped instance's console, wherever it is shown. */
export const CRASH_TAIL_LABEL = 'the last console lines Incus kept';

/** The one line `tale logs --consume` prints before it reads a running
 * console. */
export function consumingReadWarning(name: string): string {
  return `Reading the console of ${name} takes the lines it shows: Incus hands each line out once, so later reads and the console it keeps after a stop will not have them.`;
}

export interface LogReadDependencies {
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** Where the warning goes; stderr by default. */
  warn?: (line: string) => void;
}

/** Split console bytes into lines, carrying an unfinished last line. */
function splitLines(
  carry: string,
  chunk: string,
): { lines: string[]; carry: string } {
  const text = carry + chunk;
  const parts = text.split('\n');
  const rest = parts.pop() ?? '';
  return {
    lines: parts.map((line) => line.replace(/\r$/, '')),
    carry: rest,
  };
}

/**
 * What a stopped console holds that a follow has not shown. On Incus 7.6 the
 * console of an instance that stopped hands out its whole run again,
 * including the lines running reads took (measured, TI-20; ops BL-25 saw a
 * console keep only the lines no read took): where the end of what was
 * taken appears in it, only what follows is new. A replay keeps the run's
 * offsets, so the end of what was taken is looked for first where it was
 * taken (`takenFrom`, its offset in the run): a service that repeats a line
 * would otherwise match too late and lose what it printed last. Where it
 * does not appear (the console was cut at its size bound), the whole of it
 * is shown.
 */
export function untaken(
  stopped: string,
  taken: string,
  takenFrom?: number,
): string {
  if (taken === '') return stopped;
  if (takenFrom !== undefined && stopped.startsWith(taken, takenFrom))
    return stopped.slice(takenFrom + taken.length);
  const at = stopped.lastIndexOf(taken);
  return at === -1 ? stopped : stopped.slice(at + taken.length);
}

/** Whether an instance stopped by itself while it was wanted running: the
 * `boot.autorestart` limit gave up on it (design D-24, R-09). */
export function stoppedAfterCrashes(
  status: string,
  config: Readonly<IncusConfigMap>,
): boolean {
  return status === 'Stopped' && config['user.tale.want'] === 'running';
}

/**
 * Show the instance's console: line by line through `onLine`, else on this
 * process's stdout. Resolves with 0, or 1 when there is no such instance.
 */
export async function readInstanceLogs(
  context: IncusVerbContext,
  name: string,
  options: LogOptions,
  onLine?: (line: string) => void,
  dependencies: LogReadDependencies = {},
): Promise<number> {
  if (options.since !== undefined)
    throw preconditionError(
      `--since cannot be honoured on Incus: the console of ${name} keeps no times.`,
      'Bound what is shown with --tail instead.',
    );
  const read = await context.client.getInstance(name);
  if (read === undefined) {
    process.stderr.write(`There is no instance ${name}.\n`);
    return 1;
  }
  const running = (status: string) => status !== 'Stopped';
  if (running(read.instance.status)) {
    if (options.consume !== true)
      throw preconditionError(
        `${name} is running, and reading its console takes the lines it shows: Incus hands each line out once and keeps no other copy.`,
        'Run tale logs again with --consume to read it anyway, or read it once the service stopped.',
      );
    (dependencies.warn ?? ((line) => process.stderr.write(`${line}\n`)))(
      consumingReadWarning(name),
    );
  }
  const emit =
    onLine ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const sleep = dependencies.sleep ?? ((ms: number) => Bun.sleep(ms));
  const decoder = new TextDecoder();
  const readConsole = async () =>
    decoder.decode(
      await context.client.readConsole(name, {
        maxBytes: CONSOLE_MAX_BYTES,
      }),
      { stream: true },
    );

  let carry = '';
  let first = true;
  /** The end of what this follow took from the running console, and how
   * much it took in all. */
  let taken = '';
  let takenLength = 0;
  const show = (chunk: string, final: boolean) => {
    taken = (taken + chunk).slice(-TAKEN_TAIL);
    takenLength += chunk.length;
    const split = splitLines(carry, chunk);
    carry = split.carry;
    let lines = split.lines;
    if (final && carry !== '') {
      lines.push(carry);
      carry = '';
    }
    if (first && options.tail !== undefined)
      lines = options.tail === 0 ? [] : lines.slice(-options.tail);
    first = false;
    for (const line of lines) emit(line);
  };

  if (!options.follow || !running(read.instance.status)) {
    show(await readConsole(), true);
    return 0;
  }
  for (;;) {
    const now = await context.client.getInstance(name);
    if (now === undefined) {
      show('', true);
      return 0;
    }
    if (!running(now.instance.status)) {
      show(
        untaken(await readConsole(), taken, takenLength - taken.length),
        true,
      );
      return 0;
    }
    let chunk: string;
    try {
      chunk = await readConsole();
    } catch (error) {
      // The service ended between the state read and the console read, and
      // its console went with it (Incus answers 500, "connection refused"),
      // while its state may still read Running for a moment: what no read
      // took is in the console the stopped instance keeps.
      for (let attempt = 0; attempt < ENDED_STATE_READS; attempt += 1) {
        const after = await context.client.getInstance(name);
        if (after === undefined) {
          show('', true);
          return 0;
        }
        if (!running(after.instance.status)) {
          show(
            untaken(await readConsole(), taken, takenLength - taken.length),
            true,
          );
          return 0;
        }
        await sleep(dependencies.pollMs ?? FOLLOW_POLL_MS);
      }
      throw error;
    }
    show(chunk, false);
    await sleep(dependencies.pollMs ?? FOLLOW_POLL_MS);
  }
}

/**
 * The console a stopped instance left, for a crash report: at most `lines`
 * of it, under the label it deserves. Null while the instance runs (its
 * console is never read for a report) or is gone.
 */
export async function crashTail(
  context: IncusVerbContext,
  name: string,
  lines = 50,
): Promise<{ label: string; lines: string[] } | null> {
  const read = await context.client.getInstance(name);
  if (read === undefined || read.instance.status !== 'Stopped') return null;
  const text = new TextDecoder().decode(
    await context.client.readConsole(name, { maxBytes: CONSOLE_MAX_BYTES }),
  );
  const all = text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line !== '');
  return { label: CRASH_TAIL_LABEL, lines: all.slice(-lines) };
}

/** What `status` and `doctor` say of an instance `boot.autorestart` gave
 * up on (design D-24, R-09). */
const STOPPED_AFTER_CRASHES = 'stopped after repeated crashes';

/**
 * The report of an instance that stopped by itself while it was wanted
 * running: the sentence, and the tail of its stopped console under its
 * label. Null for any other instance; a running console is never read.
 */
export async function crashReport(
  context: IncusVerbContext,
  name: string,
  lines = 50,
): Promise<{
  status: typeof STOPPED_AFTER_CRASHES;
  tail: { label: string; lines: string[] };
} | null> {
  const read = await context.client.getInstance(name);
  if (
    read === undefined ||
    !stoppedAfterCrashes(read.instance.status, read.instance.config)
  )
    return null;
  const tail = await crashTail(context, name, lines);
  return tail === null ? null : { status: STOPPED_AFTER_CRASHES, tail };
}
