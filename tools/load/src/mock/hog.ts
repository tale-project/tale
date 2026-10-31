/**
 * The hog: a turn that puts an agent run's real weight on the host.
 *
 * A chat turn costs the platform a request; an agent run's turn also runs
 * commands in the run's sandbox, and those take the host's memory and CPU.
 * `[[mock:hog=<MiB>]]` makes the mock answer a turn that offers a shell tool
 * (Claude Code's `Bash`, or a `shell` whose `command` is an argv array) with
 * a call of that tool. The call runs a python3 program that holds `<MiB>` of
 * memory with every page written, and keeps one CPU busy for
 * `[[mock:hog-seconds=<s>]]`. The request that carries the call's result is
 * answered in prose, so the turn ends. The mock's metrics count the calls it
 * sent and the results that came back from a hog that ran to its end. The
 * burst scenario (`src/burst`) drives it.
 */

import type { Random } from './random.ts';
import {
  valueForSchema,
  type ArgumentHints,
  type OfferedTool,
} from './tool-args.ts';

/** What `[[mock:hog]]` holds without a value: the incident's 2 GiB. */
export const HOG_DEFAULT_MIB = 2048;
/** How long the CPU stays busy without `[[mock:hog-seconds=<s>]]`. */
export const HOG_DEFAULT_SECONDS = 60;
/** The most one hog holds, whatever its directive says. */
const HOG_MAX_MIB = 16 * 1024;
/**
 * The longest one hog spins: with its grace below, it stays inside the
 * 600 s that Claude Code's `Bash` tool allows a command at most.
 */
const HOG_MAX_SECONDS = 540;
/** Time on top of the spin for the allocation and the interpreter. */
const HOG_GRACE_SECONDS = 60;
/** The most milliseconds a shell tool's `timeout` takes. */
const SHELL_TIMEOUT_MAX_MS = 600_000;

/** Names a harness gives its shell tool, preferred over other matches. */
const SHELL_TOOL_NAME = /^(bash|shell|local_shell|run_shell_command)$/i;

export interface Hog {
  readonly mib: number;
  readonly seconds: number;
}

/** A shell tool a turn offers: one whose parameters take a `command`. */
export interface ShellTool {
  readonly tool: OfferedTool;
  /** `command` is an argv array (Codex's `shell`), not a line for a shell. */
  readonly argv: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function propertiesOf(tool: OfferedTool): Record<string, unknown> {
  return asRecord(tool.parameters.properties) ?? {};
}

function hasType(schema: unknown, ...types: string[]): boolean {
  const type = asRecord(schema)?.type;
  return typeof type === 'string' && types.includes(type);
}

/**
 * The shell tool among `tools`: one whose `command` is a string or an
 * array, a tool named like a shell first. Null when none is offered.
 */
export function findShellTool(tools: readonly OfferedTool[]): ShellTool | null {
  const shells: ShellTool[] = [];
  for (const tool of tools) {
    const command = propertiesOf(tool).command;
    if (hasType(command, 'string')) shells.push({ tool, argv: false });
    else if (hasType(command, 'array')) shells.push({ tool, argv: true });
  }
  return (
    shells.find((shell) => SHELL_TOOL_NAME.test(shell.tool.name)) ??
    shells[0] ??
    null
  );
}

/** `hog` within its bounds, in whole numbers. */
function bounded(hog: Hog): Hog {
  const whole = (value: number, max: number) =>
    Math.min(max, Math.max(0, Math.floor(value)));
  return {
    mib: whole(hog.mib, HOG_MAX_MIB),
    seconds: whole(hog.seconds, HOG_MAX_SECONDS),
  };
}

/**
 * The python3 program a hog runs. Repeating one non-zero byte writes every
 * page, so the memory is resident, not just reserved. The program holds no
 * single quote, so a shell line can quote it whole.
 */
export function hogProgram(hog: Hog): string {
  const { mib, seconds } = bounded(hog);
  return [
    'import time',
    `held = bytes([1]) * (${mib} << 20)`,
    `end = time.monotonic() + ${seconds}`,
    'spins = 0',
    'while time.monotonic() < end:',
    '    spins += 1',
    `print("held", len(held) >> 20, "MiB and spun", ${seconds}, "s")`,
  ].join('\n');
}

/** The line a hog's program prints once it held its memory and spun. */
const HOG_RESULT = /\bheld (\d+) MiB and spun (\d+) s\b/;

/**
 * The hog a tool result says ran to its end, or null when the result holds
 * no such line: the command failed, was killed, or was not a hog's.
 */
export function hogResult(content: string): Hog | null {
  const match = HOG_RESULT.exec(content);
  return match === null
    ? null
    : { mib: Number(match[1]), seconds: Number(match[2]) };
}

/**
 * The arguments of the shell call that runs `hog`. A `description` says what
 * it does, and a `timeout` or `timeout_ms` (milliseconds, as Claude Code's
 * `Bash` reads its `timeout`) leaves the spin room to finish. Any other
 * required property is generated from its schema, so the call validates.
 */
export function hogArguments(
  random: Random,
  shell: ShellTool,
  hog: Hog,
  hints: ArgumentHints,
): Record<string, unknown> {
  const { mib, seconds } = bounded(hog);
  const program = hogProgram({ mib, seconds });
  const properties = propertiesOf(shell.tool);
  const args: Record<string, unknown> = {
    command: shell.argv
      ? ['python3', '-c', program]
      : `python3 -c '${program}'`,
  };
  if (hasType(properties.description, 'string')) {
    args.description = `Hold ${mib} MiB and keep a CPU busy for ${seconds} s`;
  }
  const timeoutMs = Math.min(
    SHELL_TIMEOUT_MAX_MS,
    (seconds + HOG_GRACE_SECONDS) * 1000,
  );
  for (const key of ['timeout', 'timeout_ms']) {
    if (hasType(properties[key], 'integer', 'number')) args[key] = timeoutMs;
  }
  const required = shell.tool.parameters.required;
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key !== 'string' || key in args) continue;
      args[key] = valueForSchema(random, properties[key], key, hints);
    }
  }
  return args;
}
