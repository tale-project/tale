import { execFileSync } from 'node:child_process';

import { RingBuffer } from '@tale/shared/process';

/**
 * How long one fixture Git step may run before it is stopped and described:
 * half of the 30 s per-test budget (`bun run test`). A healthy step takes tens
 * of milliseconds, on Windows too, and the slowest fixture test that still
 * passed in the degraded Windows window of the v0.5.66 publication (#4015)
 * took 21 s in all. Its stalled `git commit`s ran into the budget instead,
 * where `bun test` kills them with nothing to show, and kills every process
 * the timed-out test starts after that: the evidence must be taken first.
 */
export const FIXTURE_GIT_BOUND_MS = 15_000;
/** The failure probe, `git --version`, which only starts Git, gets its own. */
export const FIXTURE_GIT_PROBE_MS = 2_000;
/** A step this slow is reported as it finishes, so a test that then times out
 * elsewhere still leaves its slow steps in the log: at most one line per 5 s. */
const SLOW_STEP_MS = 5_000;
const STEPS_SHOWN = 8;
const OUTPUT_SHOWN = 240;

interface Step {
  name: string;
  at: number;
  ms: number;
}
interface Failure {
  code?: unknown;
  signal?: unknown;
  status?: unknown;
  stdout?: unknown;
  stderr?: unknown;
}

/**
 * The fixture's `git -C <root> …`, trimmed output as before, within a bound.
 * A step that fails or stalls throws a report of fixed categories and
 * measurements, never its arguments or the environment: which step, how and
 * when it ended, the size and escaped end of its output, the fixture's earlier
 * steps, whether a fresh `git --version` still answers, and the Bun, platform
 * and runner image. `command` stands in a synthetic Git for the proofs.
 */
export function fixtureGit(
  root: string,
  {
    boundMs = FIXTURE_GIT_BOUND_MS,
    slowMs = SLOW_STEP_MS,
    command = ['git'],
  }: { boundMs?: number; slowMs?: number; command?: readonly string[] } = {},
): (...args: string[]) => string {
  const [file = 'git', ...prefix] = command;
  const created = performance.now();
  const steps = new RingBuffer<Step>(STEPS_SHOWN);
  let count = 0;
  return (...args) => {
    const name = subcommand(args);
    const started = performance.now();
    const at = Math.round(started - created);
    let output: string;
    try {
      output = execFileSync(file, [...prefix, '-C', root, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: boundMs,
        // Git removes its lock files on SIGTERM first; a stalled step must
        // not outlive its bound doing so. Windows ends the process either way.
        killSignal: 'SIGKILL',
      });
    } catch (error) {
      const failure = fields(error);
      const ms = Math.round(performance.now() - started);
      const earlier = steps
        .toArray()
        .map((step) => `${step.name} ${step.ms} ms at +${step.at} ms`);
      throw new Error(
        [
          `Fixture git ${name} (step ${count + 1}, +${at} ms) ${stepOutcome(failure, boundMs)} after ${ms} ms.`,
          `  output: stdout ${shown(failure.stdout, root)}; stderr ${shown(failure.stderr, root)}`,
          `  earlier steps${count > earlier.length ? ` (last ${earlier.length} of ${count})` : ''}: ${earlier.join(', ') || 'none'}`,
          `  probe: ${probe(file, prefix)}`,
          `  runtime: ${runtime()}`,
        ].join('\n'),
        { cause: error },
      );
    }
    const ms = Math.round(performance.now() - started);
    steps.push({ name, at, ms });
    count++;
    if (ms >= slowMs)
      console.warn(
        `Fixture git ${name} (step ${count}, +${at} ms) took ${ms} ms of its ${boundMs} ms bound.`,
      );
    return output.trim();
  };
}

/** How a step ended, in fixed words: what stopped it, or what it returned. */
export function stepOutcome(failure: Failure, boundMs: number): string {
  const { code, signal, status } = failure;
  // A child that exited while something it started kept the pipes open.
  if (code === 'ETIMEDOUT')
    return typeof status === 'number' && typeof signal !== 'string'
      ? `exited with status ${status} but held its output open until its ${boundMs} ms bound`
      : `was stopped at its ${boundMs} ms bound`;
  if (typeof code === 'string') return `could not complete (${word(code)})`;
  if (typeof signal === 'string')
    return `was stopped by ${word(signal)} from outside, before its ${boundMs} ms bound,`;
  if (typeof status === 'number') return `exited with status ${status}`;
  return 'failed';
}

/** Bun, the platform and a GitHub-hosted runner's image: those two image
 * variables alone, and only while they read as plain version words. */
export function runtime(environment = process.env): string {
  const image = [environment.ImageOS, environment.ImageVersion].filter(
    (value) => value !== undefined && /^[\w.-]{1,40}$/.test(value),
  );
  return `Bun ${Bun.version} on ${process.platform} ${process.arch}${image.length ? `, runner image ${image.join(' ')}` : ''}`;
}

/** The subcommand past any leading `-c name=value` or `-C path`: arguments
 * carry paths and messages, so only a plain Git command name is named. */
function subcommand(args: readonly string[]): string {
  let index = 0;
  while (args[index] === '-c' || args[index] === '-C') index += 2;
  const name = args[index] ?? '';
  return /^[a-z][a-z-]{0,29}$/.test(name) ? name : '(unnamed)';
}

/** An output's size and escaped end, the fixture root shortened. */
function shown(output: unknown, root: string): string {
  const text =
    typeof output === 'string'
      ? output
      : Buffer.isBuffer(output)
        ? output.toString('utf8')
        : '';
  if (!text) return '0 B';
  const end = [root, root.replaceAll('\\', '/')]
    .reduce((value, form) => value.split(form).join('<fixture>'), text)
    .slice(-OUTPUT_SHOWN);
  return `${Buffer.byteLength(text)} B ending ${JSON.stringify(end)}`;
}

/** Whether Git still starts and answers now, and how quickly. */
function probe(file: string, prefix: readonly string[]): string {
  const started = performance.now();
  try {
    const version = execFileSync(file, [...prefix, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: FIXTURE_GIT_PROBE_MS,
      killSignal: 'SIGKILL',
    });
    return `git --version answered in ${Math.round(performance.now() - started)} ms: ${JSON.stringify(version.trim().slice(0, 80))}`;
  } catch (error) {
    return `git --version ${stepOutcome(fields(error), FIXTURE_GIT_PROBE_MS)} after ${Math.round(performance.now() - started)} ms`;
  }
}

/** What `execFileSync` attached to its error, if it threw one. */
function fields(error: unknown): Failure {
  return typeof error === 'object' && error !== null ? error : {};
}

function word(value: string): string {
  return /^[A-Z0-9_]{1,24}$/.test(value) ? value : 'an unrecognized code';
}
